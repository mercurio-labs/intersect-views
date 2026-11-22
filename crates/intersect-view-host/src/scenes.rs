//! Read-only project view catalog and cached Rcore -> engine adapters.
use crate::{
    Host, ProjectObject, Snapshot, identity, positions,
    runtime::{Functions, Output},
};
use intersect_model::{
    core::query::QueryBudget,
    definitions::rcore_behavior::ir_v2::{DataWire, ValueWire},
};
use intersect_view_engine::{ElementId, EngineError, EngineLimits, ViewFunctions, ViewModel};
use intersect_views::{
    Binding, Owner, Palette, SceneResponse, Scope, ToolCapability, View, ViewCatalog, ViewDocument,
};
use serde::Deserialize;
use serde_json::Value;
use std::{cell::RefCell, collections::BTreeMap};

pub(super) struct ModelAdapter<'a> {
    host: &'a Host,
    snapshot: &'a Snapshot,
    keys: &'a crate::SceneKeys,
    occurrences: BTreeMap<String, ElementId>,
}
impl<'a> ModelAdapter<'a> {
    pub(super) fn new(host: &'a Host, snapshot: &'a Snapshot) -> Result<Self, String> {
        Ok(Self {
            host,
            snapshot,
            keys: snapshot.scene_keys(host)?,
            occurrences: BTreeMap::new(),
        })
    }
    pub(super) fn object(&self, id: ElementId) -> Result<ProjectObject<'a>, EngineError> {
        self.snapshot
            .objects
            .get(&id.index())
            .and_then(|id| self.snapshot.model().obj(*id))
            .ok_or_else(|| EngineError("Unknown engine element".into()))
    }
}
impl Snapshot {
    pub(super) fn scene_keys(&self, host: &Host) -> Result<&crate::SceneKeys, String> {
        self.scene_keys
            .get_or_init(|| {
                let mut keys = BTreeMap::new();
                for object in self.model().objects() {
                    let id = ElementId::new(object.id().index());
                    let key = identity::key(object, &host.language.definition.name_features, &[])?;
                    keys.entry(key)
                        .and_modify(|value| *value = None)
                        .or_insert(Some(id));
                }
                Ok(keys)
            })
            .as_ref()
            .map_err(Clone::clone)
    }
}
impl ViewModel for ModelAdapter<'_> {
    fn element(&self, key: &str) -> Option<ElementId> {
        self.occurrences
            .get(key)
            .copied()
            .or_else(|| self.keys.get(key).copied().flatten())
    }
    fn key(&self, id: ElementId) -> Result<String, EngineError> {
        Ok(identity::key(
            self.object(id)?,
            &self.host.language.definition.name_features,
            &[],
        )?)
    }
    fn is_a(&self, id: ElementId, class: &str) -> Result<bool, EngineError> {
        let target = self
            .snapshot
            .model()
            .metamodel()
            .class(class)
            .ok_or_else(|| EngineError(format!("Unknown class {class}")))?;
        Ok(self
            .snapshot
            .model()
            .metamodel()
            .is_a(self.object(id)?.class(), target))
    }
    fn class_is_a(&self, class: &str, base: &str) -> Result<bool, EngineError> {
        let mm = self.snapshot.model().metamodel();
        let class = mm
            .class(class)
            .ok_or_else(|| EngineError(format!("Unknown class {class}")))?;
        let base = mm
            .class(base)
            .ok_or_else(|| EngineError(format!("Unknown class {base}")))?;
        Ok(mm.is_a(class, base))
    }
    fn binding(&self, id: ElementId, context: &[String]) -> Result<Binding, EngineError> {
        let object = self.object(id)?;
        let text = self
            .host
            .source_text(object.resource())
            .ok_or_else(|| EngineError("Missing binding source".into()))?;
        Ok(identity::binding(
            object,
            &self.host.language.definition.name_features,
            text,
            &self.host.editable,
            context,
        )?)
    }
    fn source_text(&self, id: ElementId) -> Result<String, EngineError> {
        let object = self.object(id)?;
        let text = self
            .host
            .source_text(object.resource())
            .ok_or_else(|| EngineError("Missing stored source text".into()))?;
        let (start, end) = object.span();
        if start >= end || end.saturating_sub(start) > 4096 {
            return Err(EngineError(format!(
                "view.sourceText.span: {}:{start}..{end}: expected a nonempty source span of at most 4096 bytes",
                object.resource()
            )));
        }
        let span = text.get(start..end).ok_or_else(|| {
            EngineError(format!(
                "view.sourceText.range: {}:{start}..{end}",
                object.resource()
            ))
        })?;
        Ok(span.replace("\r\n", "\n").replace('\t', "    "))
    }
}
pub(super) struct FunctionAdapter<'a> {
    pub(super) cache: &'a Functions<'a>,
    pub(super) snapshot: &'a Snapshot,
    pub(super) budget: &'a RefCell<QueryBudget>,
}
impl FunctionAdapter<'_> {
    fn invoke(&self, name: &str, id: ElementId, expected: u8) -> Result<ValueWire, EngineError> {
        let function = self
            .cache
            .functions
            .get(name)
            .ok_or_else(|| EngineError(format!("Unknown view function {name}")))?;
        if !matches!(
            (&function.output, expected),
            (Output::Elements(_), 0) | (Output::Boolean, 1) | (Output::String, 2)
        ) {
            return Err(EngineError(format!(
                "Function {name} has an incompatible result"
            )));
        }
        let owner = self
            .snapshot
            .objects
            .get(&id.index())
            .and_then(|object| self.snapshot.model().obj(*object))
            .ok_or_else(|| EngineError("Missing function owner".into()))?;
        let mut budget = self
            .budget
            .try_borrow_mut()
            .map_err(|e| EngineError(e.to_string()))?;
        function
            .function
            .invoke_model(
                self.snapshot.accepted.reader(),
                owner.identity(),
                vec![],
                &mut budget,
            )
            .map_err(|e| {
                if budget.remaining() == 0 {
                    EngineError::limit("function-call work units")
                } else {
                    EngineError(format!("Function {name}: {e}"))
                }
            })
    }
}
impl ViewFunctions for FunctionAdapter<'_> {
    fn elements(&self, name: &str, id: ElementId) -> Result<Vec<ElementId>, EngineError> {
        let result = self.invoke(name, id, 0)?;
        let DataWire::Collection(values) = result.data else {
            return Err(EngineError(format!(
                "Function {name} did not return elements"
            )));
        };
        values
            .into_iter()
            .map(|value| {
                let DataWire::Model(json) = value.data else {
                    return Err(EngineError("Expected model result".into()));
                };
                let object = self
                    .snapshot
                    .model()
                    .lookup(
                        json["element"]
                            .as_str()
                            .ok_or_else(|| EngineError("Missing result identity".into()))?,
                    )
                    .ok_or_else(|| EngineError("Result is absent from accepted model".into()))?;
                if let Output::Elements(expected) = &self
                    .cache
                    .functions
                    .get(name)
                    .ok_or_else(|| EngineError("Missing function metadata".into()))?
                    .output
                {
                    let mm = self.snapshot.model().metamodel();
                    let required = mm
                        .class(expected)
                        .ok_or_else(|| EngineError("Missing declared result class".into()))?;
                    if !mm.is_a(object.class(), required) {
                        return Err(EngineError("Incompatible declared element result".into()));
                    }
                }
                Ok(ElementId::new(object.id().index()))
            })
            .collect()
    }
    fn boolean(&self, name: &str, id: ElementId) -> Result<bool, EngineError> {
        let function = self
            .cache
            .functions
            .get(name)
            .ok_or_else(|| EngineError(format!("Unknown predicate {name}")))?;
        let receiver = self
            .snapshot
            .model()
            .metamodel()
            .class(&function.receiver)
            .ok_or_else(|| EngineError("Missing predicate receiver".into()))?;
        let object = self
            .snapshot
            .objects
            .get(&id.index())
            .and_then(|object| self.snapshot.model().obj(*object))
            .ok_or_else(|| EngineError("Missing predicate element".into()))?;
        if !self
            .snapshot
            .model()
            .metamodel()
            .is_a(object.class(), receiver)
        {
            return Ok(false);
        }

        let result = self.invoke(name, id, 1)?;
        let DataWire::Scalar(value) = result.data else {
            return Err(EngineError("Expected Bool result".into()));
        };
        value
            .payload
            .as_bool()
            .ok_or_else(|| EngineError("Expected Bool payload".into()))
    }
    fn string(&self, name: &str, id: ElementId) -> Result<String, EngineError> {
        let result = self.invoke(name, id, 2)?;
        let DataWire::Scalar(value) = result.data else {
            return Err(EngineError("Expected String result".into()));
        };
        value
            .payload
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| EngineError("Expected String payload".into()))
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SceneRequest {
    revision: u64,
    view_key: String,
    #[serde(default)]
    scope: Option<Scope>,
    #[serde(default)]
    palette: Option<Palette>,
}
impl Host {
    pub(super) fn target_ids(
        &self,
        rules: &intersect_views::GraphRuleSet,
        scene: &intersect_views::GraphScene,
        tool: &intersect_views::Tool,
        source: Option<&str>,
    ) -> Result<Vec<String>, String> {
        let snapshot = self.snapshot()?;
        let mut model = ModelAdapter::new(self, snapshot)?;
        // Anonymous binding keys include occurrence context. Register those
        // aliases against this accepted snapshot before evaluating predicates.
        for node in intersect_view_engine::legality::nodes(scene) {
            for binding in
                std::iter::once(&node.binding).chain(node.ports.iter().map(|p| &p.binding))
            {
                let object = snapshot
                    .model()
                    .lookup(&binding.element_id)
                    .ok_or("Target binding is outside the accepted model")?;
                model
                    .occurrences
                    .insert(binding.key.clone(), ElementId::new(object.id().index()));
            }
        }
        let limits = EngineLimits {
            function_work: self.language.definition.view_function_work,
            ..Default::default()
        };
        let budget = RefCell::new(QueryBudget::new(limits.function_work));
        let functions = FunctionAdapter {
            cache: self.language.cache(),
            snapshot,
            budget: &budget,
        };
        intersect_view_engine::legality::targets(
            rules, scene, tool, source, &model, &functions, limits,
        )
        .map_err(|e| e.to_string())
    }
    pub(super) fn views_targets(&self, params: &Value) -> Result<Value, String> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Request {
            revision: u64,
            view_key: String,
            tool_id: String,
            #[serde(default)]
            scope: Option<Scope>,
            #[serde(default)]
            palette: Option<Palette>,
            #[serde(default)]
            source: Option<String>,
        }
        let request: Request = serde_json::from_value(params.clone())
            .map_err(|e| format!("Invalid target request: {e}"))?;
        let response =
            self.scene_response(&request.view_key, request.scope.as_ref(), request.palette)?;
        let tool = response
            .scene
            .palette()
            .groups
            .iter()
            .flat_map(|g| &g.entries)
            .find(|t| t.id == request.tool_id)
            .ok_or("Unknown tool")?;
        let rules = self.rules_for(response.scene.rule_set())?.graph()?;
        let symbols = if intersect_view_engine::legality::command_for(rules, tool)
            .is_some_and(|id| self.commands.supports(&id))
        {
            self.target_ids(
                rules,
                response.scene.graph()?,
                tool,
                request.source.as_deref(),
            )?
        } else {
            vec![]
        };
        let response = intersect_views::TargetResponse {
            revision: request.revision,
            view_key: request.view_key,
            tool_id: request.tool_id,
            source: request.source,
            symbols,
        };
        response.validate()?;
        serde_json::to_value(response).map_err(|e| e.to_string())
    }
    fn project_views(&self) -> Result<Vec<crate::ModelView>, String> {
        let snapshot = self.snapshot()?;
        let mut views = vec![];
        let mut keys = std::collections::BTreeSet::new();
        for (uri, text) in &self.sources {
            if !uri.ends_with(".view.json") {
                continue;
            }
            let Ok(doc) = serde_json::from_str::<ViewDocument>(text) else {
                continue;
            };
            if doc.validate().is_err()
                || !self
                    .language
                    .cache()
                    .rules
                    .iter()
                    .any(|r| r.id() == doc.rule_set)
            {
                continue;
            }
            if !keys.insert(doc.key.clone()) {
                return Err(format!("Duplicate view document key {}", doc.key));
            }
            let view = self.document_view(uri, &doc, snapshot)?;
            views.push(crate::ModelView::Resolved {
                document: doc,
                view,
                selection: None,
            });
        }
        if let Some(provider) = &self.model_views {
            let context = crate::ModelViewContext {
                host: self,
                snapshot,
                budget: RefCell::new(QueryBudget::new(
                    self.language.definition.view_function_work,
                )),
            };
            let supplied = provider.views(&context)?;
            if supplied.len() > 500 {
                return Err("Model-defined view catalog exceeds 500 views".into());
            }
            for mut supplied in supplied {
                if let crate::ModelView::Unsupported { view, diagnostics } = &mut supplied {
                    view.problems = diagnostics.iter().map(|d| d.message.clone()).collect();
                }
                let view = supplied.view();
                if !keys.insert(view.key.clone()) {
                    return Err("Duplicate model-defined view key".into());
                }
                let check_binding = |b: &intersect_views::Binding| -> Result<(), String> {
                    let object = snapshot
                        .model()
                        .lookup(&b.element_id)
                        .ok_or("Model view binding is outside accepted model")?;
                    if serde_json::to_value(context.binding(object)?).map_err(|e| e.to_string())?
                        != serde_json::to_value(b).map_err(|e| e.to_string())?
                    {
                        return Err("Model view has incorrect source binding".into());
                    }
                    Ok(())
                };
                check_binding(&view.binding)?;
                match &supplied {
                    crate::ModelView::Resolved {
                        document,
                        selection,
                        ..
                    } => {
                        document.validate()?;
                        if document.key != view.key {
                            return Err("Mismatched model view key".into());
                        }
                        let rules = self.rules_for(&document.rule_set)?;
                        if let Some(selection) = selection {
                            check_binding(&selection.origin_binding)?;
                            if let Some(b) = &selection.canonical_rendering {
                                check_binding(b)?;
                            }
                            let registry = context
                                .rendering_registry()
                                .ok_or("Missing rendering registry")?;
                            let registration = registry
                                .registrations
                                .iter()
                                .find(|r| r.id == selection.registration_id)
                                .ok_or("Missing rendering registration")?;
                            if selection.package_fingerprint != context.presentation_fingerprint()
                                || registration.rule_set_id != document.rule_set
                                || selection.rule_set_id != document.rule_set
                                || registration.projection_policy != selection.projection_policy
                                || rules.graph()?.projection != selection.projection_policy
                            {
                                return Err(
                                    "Rendering registration/package/rule policy mismatch".into()
                                );
                            }
                        }
                    }
                    crate::ModelView::Unsupported { diagnostics, .. } => {
                        for diagnostic in diagnostics {
                            check_binding(&diagnostic.binding)?;
                        }
                    }
                }
                let resolution = self.model_resolution(&supplied);
                resolution.validate()?;
                views.push(supplied);
            }
        }
        Ok(views)
    }
    pub(super) fn document_view(
        &self,
        uri: &str,
        doc: &ViewDocument,
        snapshot: &Snapshot,
    ) -> Result<View, String> {
        let text = self.sources.get(uri).ok_or("Missing view source")?;
        let mut owners = vec![];
        for object in snapshot.model().objects() {
            if let Some(name) = identity::name(object, &self.language.definition.name_features) {
                owners.push(Owner {
                    key: identity::key(object, &self.language.definition.name_features, &[])?,
                    label: name.into(),
                });
            }
        }
        Ok(View {
            key: doc.key.clone(),
            name: doc.name.clone(),
            kind: doc.rule_set.clone(),
            binding: Binding {
                key: doc.key.clone(),
                element_id: format!("document:{uri}"),
                context: vec![],
                uri: uri.into(),
                range: positions::range(text, 0, text.len()),
                read_only: false,
            },
            owners,
            details: vec![],
            problems: vec![],
        })
    }
    fn model_resolution(&self, entry: &crate::ModelView) -> intersect_views::RenderingResolution {
        use intersect_views::RenderingStatus;
        let (status, selection, diagnostics) = match entry {
            crate::ModelView::Resolved {
                selection: Some(s), ..
            } => (RenderingStatus::Resolved, Some(s.as_ref().clone()), vec![]),
            crate::ModelView::Resolved {
                selection: None, ..
            } => (RenderingStatus::Unmanaged, None, vec![]),
            crate::ModelView::Unsupported { diagnostics, .. } => {
                (RenderingStatus::Unsupported, None, diagnostics.clone())
            }
        };
        intersect_views::RenderingResolution {
            schema_version: 1,
            revision: self.revision,
            view_key: entry.view().key.clone(),
            status,
            selection,
            diagnostics,
        }
    }
    pub(super) fn views_rendering(&self, params: &Value) -> Result<Value, String> {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct Request {
            revision: u64,
            view_key: String,
        }
        let request: Request = serde_json::from_value(params.clone()).map_err(|e| e.to_string())?;
        if request.revision != self.revision {
            return Err("Rendering revision is stale".into());
        }
        let entries = self.project_views()?;
        let entry = entries
            .iter()
            .find(|e| e.view().key == request.view_key)
            .ok_or("Unknown view")?;
        let response = self.model_resolution(entry);
        response.validate()?;
        serde_json::to_value(response).map_err(|e| e.to_string())
    }
    pub(super) fn views_catalog(&self) -> Result<Value, String> {
        let views = self
            .project_views()?
            .iter()
            .map(|entry| entry.view().clone())
            .collect::<Vec<_>>();
        let catalog = ViewCatalog {
            schema_version: 1,
            revision: self.revision,
            views,
        };
        catalog.validate()?;
        serde_json::to_value(catalog).map_err(|e| e.to_string())
    }
    pub(super) fn views_scene(&self, params: &Value) -> Result<Value, String> {
        let request: SceneRequest = serde_json::from_value(params.clone())
            .map_err(|e| format!("Invalid scene request: {e}"))?;
        if request.revision != self.revision {
            return Err("Scene revision is stale".into());
        }
        serde_json::to_value(self.scene_response(
            &request.view_key,
            request.scope.as_ref(),
            request.palette,
        )?)
        .map_err(|e| e.to_string())
    }
    pub(super) fn rules_for(&self, id: &str) -> Result<&intersect_views::RuleSet, String> {
        self.language
            .cache()
            .rules
            .iter()
            .find(|r| r.id() == id)
            .ok_or_else(|| format!("Unknown rule set {id}"))
    }
    pub(super) fn scene_response(
        &self,
        view_key: &str,
        scope: Option<&Scope>,
        palette: Option<Palette>,
    ) -> Result<SceneResponse, String> {
        let snapshot = self.snapshot()?;
        let views = self.project_views()?;
        let entry = views
            .iter()
            .find(|e| e.view().key == view_key)
            .ok_or_else(|| format!("Unknown view {view_key}"))?;
        let doc = entry.document()?;
        let view = entry.view();
        if !view.problems.is_empty() {
            return Err(view.problems.join("\n"));
        }
        let rules = self
            .language
            .cache()
            .rules
            .iter()
            .find(|r| r.id() == doc.rule_set)
            .ok_or("Unknown rule set")?;
        if let intersect_views::RuleSet::Grid(rules) = rules {
            return self.grid_response(view, doc, rules, scope, palette);
        }
        if let intersect_views::RuleSet::LaneGraph(rules) = rules {
            return self.lane_response(view, doc, rules, scope, palette);
        }
        let rules = rules.graph()?;
        let scope = scope.unwrap_or(&doc.scope);
        if let Some(provider) = &self.model_views
            && matches!(
                entry,
                crate::ModelView::Resolved {
                    selection: Some(_),
                    ..
                }
            )
        {
            let context = crate::ModelViewContext {
                host: self,
                snapshot,
                budget: RefCell::new(QueryBudget::new(
                    self.language.definition.view_function_work,
                )),
            };
            provider.validate_scope(&context, view, scope)?;
        }
        let palette = if let Some(palette) = palette {
            palette
        } else if let Some(palette) = self.presentation.as_ref().and_then(|p| p.palette.as_ref()) {
            palette.clone()
        } else if self.language.definition.palette.is_empty() {
            default_palette(rules)?
        } else {
            serde_json::from_str(&self.language.definition.palette)
                .map_err(|e| format!("Invalid palette: {e}"))?
        };
        palette.validate()?;
        for edit in rules.label_edits() {
            if let Some(tool) = palette
                .groups
                .iter()
                .flat_map(|g| &g.entries)
                .find(|t| t.id == edit.tool)
                && (tool.command != edit.command || tool.gesture != "action")
            {
                return Err("Label palette tool/command mismatch".into());
            }
        }
        let model = ModelAdapter::new(self, snapshot)?;
        let limits = EngineLimits {
            function_work: self.language.definition.view_function_work,
            ..Default::default()
        };
        let budget = RefCell::new(QueryBudget::new(limits.function_work));
        let functions = FunctionAdapter {
            cache: self.language.cache(),
            snapshot,
            budget: &budget,
        };
        let mut scene = intersect_view_engine::evaluate(
            rules,
            scope,
            view.clone(),
            palette,
            self.revision,
            &model,
            &functions,
            limits,
        )
        .map_err(|e| e.to_string())?;
        self.finalize_graphics(&mut scene)?;
        let capabilities = scene
            .palette
            .groups
            .iter()
            .flat_map(|g| g.entries.iter())
            .map(|t| {
                let enabled = t.gesture == "select"
                    || matches!(
                        t.command.as_str(),
                        "presentation.fit" | "presentation.layout"
                    )
                    || rules.label_edits().iter().any(|e| {
                        e.tool == t.id
                            && e.command == t.command
                            && t.gesture == "action"
                            && self.commands.supports(&e.command)
                    })
                    || intersect_view_engine::legality::command_for(rules, t)
                        .is_some_and(|id| self.commands.supports(&id));
                ToolCapability {
                    tool_id: t.id.clone(),
                    enabled,
                    reason: if enabled {
                        String::new()
                    } else {
                        "Tool has no supported rule command".into()
                    },
                }
            })
            .collect();
        let response = SceneResponse {
            scene: scene.into(),
            capabilities,
            presentation: self.presentation_context(),
        };
        response.validate()?;
        Ok(response)
    }
}
fn default_palette(rules: &intersect_views::GraphRuleSet) -> Result<Palette, String> {
    let mut tools = vec![
        serde_json::json!({"id":"select","label":"Select","icon":"pointer","gesture":"select","command":"presentation.select","parameters":{},"inputs":[]}),
    ];
    let mut seen = std::collections::BTreeSet::new();
    for create in rules.symbols.iter().flat_map(|r| &r.create) {
        if seen.insert(create.tool.clone()) {
            tools.push(serde_json::json!({"id":create.tool,"label":create.tool,"icon":"box","gesture":"place","command":create.command,"parameters":{"placement":"node"},"inputs":[{"id":"name","label":"Name","default":"NewElement"}]}));
        }
    }
    for edit in rules.label_edits() {
        if seen.insert(edit.tool.clone()) {
            tools.push(serde_json::json!({"id":edit.tool,"label":edit.tool,"icon":"box","gesture":"action","command":edit.command,"parameters":{},"inputs":[]}));
        }
    }
    for edge in &rules.edges {
        if let Some(connect) = edge.connect() {
            tools.push(serde_json::json!({"id":edge.id(),"label":edge.id(),"icon":"connection","gesture":"place","command":connect.command,"parameters":{"placement":"connection"},"inputs":[{"id":"name","label":"Name","default":"NewLink"}]}));
        }
    }
    let palette:Palette=serde_json::from_value(serde_json::json!({"schemaVersion":1,"id":format!("{}.default",rules.id),"label":rules.label,"groups":[{"id":"tools","label":"Tools","entries":tools}]})).map_err(|e|e.to_string())?;
    palette.validate()?;
    Ok(palette)
}
