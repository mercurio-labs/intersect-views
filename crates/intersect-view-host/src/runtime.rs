//! Host-owned Rcore function cache and language-aware rule checks.
use crate::language::{Language, LanguageDefinition};
use intersect_model::{
    definitions::{
        bundle::{DefinitionBundle, SourceId},
        ecore::ParseLimits,
        rcore_behavior::{
            ir_v2::{Effect, EntrySelection, Limits, TypeNode},
            modules::{ModuleIndex, ModuleIndexPreparation, SymbolId, SymbolKind},
            types::{CollectionKind, Scalar},
        },
    },
    source_model_functions::SourceModelFunction,
};
use intersect_views::{
    EdgeRule, GraphRuleSet, GridDefinition, LabelRule, RuleSet, Slot, Subject, SymbolRule,
};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Output {
    Elements(String),
    Boolean,
    String,
}
pub(crate) struct Function<'a> {
    pub function: SourceModelFunction<'a>,
    pub receiver: String,
    pub output: Output,
}
pub(crate) struct Functions<'a> {
    pub functions: BTreeMap<String, Function<'a>>,
    pub rules: Vec<RuleSet>,
    pub queries: BTreeMap<(String, String), crate::grid_query::GridQuery>,
}
self_cell::self_cell! {pub(crate) struct Runtime {owner:Language,#[covariant] dependent:Functions,}}
impl std::ops::Deref for Runtime {
    type Target = Language;
    fn deref(&self) -> &Language {
        self.borrow_owner()
    }
}
impl Runtime {
    pub fn prepare(definition: LanguageDefinition) -> Result<Self, String> {
        Self::from_language(Language::new(definition)?)
    }
    pub(crate) fn from_language(language: Language) -> Result<Self, String> {
        Self::try_new(language, |language| Functions::compile(language))
    }
    pub fn cache(&self) -> &Functions<'_> {
        self.borrow_dependent()
    }
}
fn slot_refs(slot: Option<&Slot>, origin: &str, result: &mut BTreeMap<String, String>) {
    if let Some(Slot::Function(name)) = slot {
        result.entry(name.clone()).or_insert_with(|| origin.into());
    }
}
fn label_refs(label: Option<&LabelRule>, origin: &str, result: &mut BTreeMap<String, String>) {
    if let Some(label) = label {
        match label {
            LabelRule::Scalar(s) => slot_refs(Some(s), origin, result),
            LabelRule::Parts(r) => {
                for p in &r.parts {
                    slot_refs(Some(&p.text), origin, result);
                    if let Some(w) = &p.when {
                        result.insert(w.clone(), origin.into());
                    }
                    if let Subject::Select { select } = &p.subject {
                        result.insert(select.clone(), origin.into());
                    }
                    if let Some(e) = &p.edit {
                        result.insert(e.accepts.clone(), origin.into());
                    }
                }
            }
        }
    }
}
fn graphic_refs(
    rule: Option<&intersect_views::GraphicRule>,
    origin: &str,
    result: &mut BTreeMap<String, String>,
) {
    if let Some(rule) = rule {
        for parameter in rule.parameters.values() {
            match parameter {
                intersect_views::ParameterRule::String { value } => {
                    slot_refs(Some(value), origin, result)
                }
                intersect_views::ParameterRule::Bool { function } => {
                    result
                        .entry(function.clone())
                        .or_insert_with(|| origin.into());
                }
                _ => {}
            }
        }
        for block in rule.text.values() {
            for run in &block.runs {
                label_refs(Some(&run.label), origin, result);
            }
        }
    }
}
fn collect(rules: &[RuleSet]) -> BTreeMap<String, String> {
    let mut result = BTreeMap::new();
    for rules in rules {
        if let RuleSet::LaneGraph(r) = rules {
            let g = &r.lane_graph;
            for name in [
                &g.container.lanes,
                &g.container.steps,
                &g.step.lane,
                &g.step.after,
                &g.step.end,
                &g.step.across,
            ] {
                result.insert(name.clone(), r.id.clone());
            }
            label_refs(Some(&g.lane.label), &r.id, &mut result);
            label_refs(Some(&g.step.label), &r.id, &mut result);
            if let Some(e) = &g.edit {
                result.insert(e.accepts.clone(), r.id.clone());
            }
            continue;
        }
        let RuleSet::Graph(rules) = rules else {
            if let RuleSet::Grid(g) = rules
                && let GridDefinition::Matrix { cells, .. } = &g.grid
            {
                result.insert(cells.related.clone(), g.id.clone());
                if let Some(m) = &cells.members {
                    for name in [&m.select, &m.column, &m.label] {
                        result.insert(name.clone(), g.id.clone());
                    }
                }
                if let Some(e) = &cells.edit {
                    if let Some(c) = &e.create {
                        for name in [&c.row_accepts, &c.column_accepts] {
                            result.insert(name.clone(), g.id.clone());
                        }
                    }
                    if let Some(d) = &e.delete {
                        result.insert(d.accepts.clone(), g.id.clone());
                    }
                }
            }
            continue;
        };
        for rule in &rules.symbols {
            graphic_refs(rule.graphic.as_ref(), &rule.id, &mut result);
            for create in &rule.create {
                result
                    .entry(create.accepts.clone())
                    .or_insert_with(|| rule.id.clone());
            }
            for slot in [&rule.title, &rule.subtitle, &rule.label] {
                label_refs(slot.as_ref(), &rule.id, &mut result);
            }
            for slot in [&rule.side, &rule.style_class] {
                slot_refs(slot.as_ref(), &rule.id, &mut result);
            }
            if let Some(r) = &rule.regions {
                for name in [&r.select, &r.children.select] {
                    result.insert(name.clone(), r.id.clone());
                }
                label_refs(Some(&r.label), &r.id, &mut result);
            }
            for c in &rule.compartments {
                result
                    .entry(c.rows.clone())
                    .or_insert_with(|| rule.id.clone());
                label_refs(Some(&c.row_label), &rule.id, &mut result);
            }
            if let Some(p) = &rule.ports {
                result
                    .entry(p.select.clone())
                    .or_insert_with(|| rule.id.clone());
            }
            if let Some(c) = &rule.children {
                result
                    .entry(c.select.clone())
                    .or_insert_with(|| rule.id.clone());
            }
            for option in &rule.expand {
                result
                    .entry(option.select.clone())
                    .or_insert_with(|| rule.id.clone());
            }
        }
        for edge in &rules.edges {
            for marker in edge.markers().into_iter().flatten() {
                graphic_refs(Some(marker), edge.id(), &mut result);
            }
            if let Some(connect) = edge.connect() {
                for name in [&connect.source_accepts, &connect.target_accepts] {
                    result
                        .entry(name.clone())
                        .or_insert_with(|| edge.id().into());
                }
            }
            match edge {
                EdgeRule::Element {
                    id,
                    select,
                    label,
                    source_path,
                    target_path,
                    ..
                } => {
                    for name in [select, source_path, target_path] {
                        result.entry(name.clone()).or_insert_with(|| id.clone());
                    }
                    label_refs(Some(label), id, &mut result);
                }
                EdgeRule::Reference {
                    id, targets, label, ..
                } => {
                    result.entry(targets.clone()).or_insert_with(|| id.clone());
                    label_refs(Some(label), id, &mut result);
                }
            }
        }
    }
    result
}
fn resolve(
    language: &Language,
    bundle: &DefinitionBundle,
    name: &str,
    indexes: &mut BTreeMap<SourceId, ModuleIndex>,
) -> Result<SymbolId, String> {
    let helpers: BTreeSet<SourceId> = language
        .definition
        .view_functions
        .iter()
        .flat_map(|s| s.dependencies.iter().cloned())
        .collect();
    let mut direct = vec![];
    let mut all = vec![];
    let mut qualified = vec![];
    for original in &language.definition.view_functions {
        let source = bundle
            .sources
            .iter()
            .find(|s| s.id.uri == original.id.uri)
            .ok_or("Missing view source")?;
        if !indexes.contains_key(&source.id) {
            let context = intersect_model::definitions::conversion::InvocationContext::default();
            let mut indexing = ModuleIndexPreparation::begin(
                bundle,
                &source.id,
                ParseLimits {
                    source_bytes: 1_000_000,
                },
                &context,
            )
            .map_err(|e| format!("Index view source: {e:?}"))?;
            while !indexing
                .advance(&context)
                .map_err(|e| format!("Index view source: {e:?}"))?
            {}
            indexes.insert(
                source.id.clone(),
                indexing
                    .finish()
                    .map_err(|e| format!("Index view source: {e:?}"))?,
            );
        }
        let index = indexes
            .get(&source.id)
            .ok_or("Missing prepared module index")?;
        let module = index.module(&source.id)?;
        for symbol in module
            .symbols
            .iter()
            .filter(|s| s.public && s.kind == SymbolKind::Function)
        {
            let short = symbol.name.join(".");
            let full = format!("{}.{short}", module.path.join("."));
            if full == name {
                qualified.push(symbol.id.clone());
            }
            if short == name {
                all.push(symbol.id.clone());
                if !helpers.contains(&original.id) {
                    direct.push(symbol.id.clone());
                }
            }
        }
    }
    let candidates = if !qualified.is_empty() {
        qualified
    } else if !direct.is_empty() {
        direct
    } else {
        all
    };
    match candidates.as_slice() {
        [id] => Ok(id.clone()),
        [] => Err(format!("Unknown public view function {name}")),
        _ => Err(format!("Ambiguous public view function {name}")),
    }
}
impl<'a> Functions<'a> {
    fn validate_grid(
        &self,
        language: &Language,
        rules: &intersect_views::GridRuleSet,
    ) -> Result<(), String> {
        use intersect_model::core::query::ScalarType;
        let label = |role: &str, name: &str, allow_optional: bool| -> Result<(), String> {
            let q = &self.queries[&(rules.id.clone(), role.into())];
            let i = q
                .plan
                .select
                .iter()
                .position(|c| c.name == name)
                .ok_or("Missing axis label projection")?;
            let ty = q.types.get(i).ok_or("Invalid label projection")?;
            if ty.scalar != ScalarType::String || ty.many {
                return Err("Grid axis label must be a singular String".into());
            }
            if ty.optional && !allow_optional {
                return Err("Grid matrix axis label must be a required String".into());
            }
            Ok(())
        };
        match &rules.grid {
            // A table may use an optional source attribute such as declaredName.
            // Evaluation requires a present string on each admitted row.
            GridDefinition::Table { row_label, .. } => label("table", row_label, true)?,
            GridDefinition::Matrix {
                rows,
                columns,
                cells,
            } => {
                label("rows", &rows.label, false)?;
                label("columns", &columns.label, false)?;
                let row = self.queries[&(rules.id.clone(), "rows".into())]
                    .plan
                    .from
                    .as_str();
                let column = self.queries[&(rules.id.clone(), "columns".into())]
                    .plan
                    .from
                    .as_str();
                let conforms = |actual: &str| -> Result<(), String> {
                    let a = language
                        .metamodel
                        .class(actual)
                        .ok_or("Unknown grid result class")?;
                    let b = language
                        .metamodel
                        .class(column)
                        .ok_or("Unknown column class")?;
                    if !language.metamodel.is_a(a, b) {
                        return Err("Incompatible matrix column result".into());
                    }
                    Ok(())
                };
                conforms(
                    &self
                        .require(language, &cells.related, row, &rules.id, true)?
                        .ok_or("Missing related result")?,
                )?;
                if let Some(m) = &cells.members {
                    let member = self
                        .require(language, &m.select, row, &rules.id, true)?
                        .ok_or("Missing member result")?;
                    conforms(
                        &self
                            .require(language, &m.column, &member, &rules.id, true)?
                            .ok_or("Missing member column")?,
                    )?;
                    self.require(language, &m.label, &member, &rules.id, false)?;
                    if let Some(e) = &cells.edit
                        && let Some(d) = &e.delete
                    {
                        self.predicate(language, &d.accepts, Some(&member), &rules.id)?;
                    }
                }
                if let Some(e) = &cells.edit
                    && let Some(c) = &e.create
                {
                    self.predicate(language, &c.row_accepts, Some(row), &rules.id)?;
                    self.predicate(language, &c.column_accepts, Some(column), &rules.id)?;
                }
            }
        }
        Ok(())
    }
    fn compile(language: &'a Language) -> Result<Self, String> {
        if language
            .definition
            .view_functions
            .iter()
            .any(|s| s.text.len() > 1_000_000)
        {
            return Err("View function source size budget exceeded".into());
        }
        if !language.definition.notation.is_empty() {
            let notation: intersect_views::NotationProfile =
                serde_json::from_str(&language.definition.notation)
                    .map_err(|e| format!("Invalid notation: {e}"))?;
            notation.validate()?;
        }
        let mut rules = vec![];
        let mut ids = BTreeSet::new();
        for text in &language.definition.rule_sets {
            let rule: RuleSet =
                serde_json::from_str(text).map_err(|e| format!("Invalid rule set: {e}"))?;
            rule.validate()?;
            if rule.language() != language.definition.namespace {
                return Err(format!("Rule set {} uses another language", rule.id()));
            }
            if !ids.insert(rule.id().to_owned()) {
                return Err(format!("Duplicate rule set {}", rule.id()));
            }
            rules.push(rule);
        }
        let prepared = language.prepared();
        let mut additional = vec![];
        for source in &language.definition.view_functions {
            if !prepared
                .sources()
                .sources
                .iter()
                .any(|s| s.id.uri == source.id.uri)
            {
                let mut source = source.clone();
                for dependency in &mut source.dependencies {
                    if *dependency == language.definition.structure.id {
                        *dependency = prepared.selection().ecore.clone();
                    }
                }
                additional.push(source);
            }
        }
        let mut bundle = prepared.sources().clone();
        bundle.sources.extend(additional.iter().cloned());
        let mut functions = BTreeMap::new();
        let mut indexes = BTreeMap::new();
        let mut entries = collect(&rules);
        for name in &language.definition.extra_functions {
            entries
                .entry(name.clone())
                .or_insert_with(|| "model view catalog".into());
        }
        let mut selected = Vec::with_capacity(entries.len());
        let mut origins = Vec::with_capacity(entries.len());
        for (name, origin) in entries {
            let symbol = resolve(language, &bundle, &name, &mut indexes)
                .map_err(|e| format!("Rule {origin}: {e}"))?;
            selected.push(EntrySelection {
                symbol,
                types: vec![],
                arguments: vec![],
            });
            origins.push((name, origin));
        }
        let compiled = SourceModelFunction::from_prepared_many(
            prepared,
            additional,
            &selected,
            &Limits::default(),
            language.definition.view_execution_limits.clone(),
            ParseLimits {
                source_bytes: 1_000_000,
            },
        )
        .map_err(|e| format!("View function batch: {e}"))?;
        if compiled.len() != origins.len() {
            return Err("Incomplete view function batch".into());
        }
        for ((name, origin), function) in origins.into_iter().zip(compiled) {
            let image = function.executable();
            let program = image.program();
            if image
                .function_effect(program.entry)
                .map_err(|e| e.to_string())?
                == Effect::Construct
            {
                return Err(format!(
                    "Rule {origin}, function {name}: constructing view functions are refused"
                ));
            }
            let entry = program
                .functions
                .get(program.entry.0 as usize)
                .ok_or("Missing function entry")?;
            if entry.parameters.len() != 1 {
                return Err(format!(
                    "Rule {origin}, function {name}: view functions require one element parameter"
                ));
            }
            let TypeNode::Model(target) = program
                .types
                .get(entry.parameters[0].0 as usize)
                .ok_or("Missing receiver type")?
            else {
                return Err(format!("Function {name} requires a model receiver"));
            };
            let receiver = function.schema().class_key_for_type(target)?.to_owned();
            let output = match program.types.get(entry.result.0 as usize) {
                Some(TypeNode::Scalar(Scalar::Bool)) => Output::Boolean,
                Some(TypeNode::Scalar(Scalar::String)) => Output::String,
                Some(TypeNode::Collection {
                    kind: CollectionKind::Sequence,
                    element,
                }) => {
                    let Some(TypeNode::Model(target)) = program.types.get(element.0 as usize)
                    else {
                        return Err(format!(
                            "Function {name} must return a sequence of elements"
                        ));
                    };
                    Output::Elements(function.schema().class_key_for_type(target)?.to_owned())
                }
                _ => {
                    return Err(format!(
                        "Rule {origin}, function {name}: unsupported view result type"
                    ));
                }
            };
            functions.insert(
                name,
                Function {
                    function,
                    receiver,
                    output,
                },
            );
        }
        let mut queries = BTreeMap::new();
        for rule in &rules {
            if let RuleSet::Grid(g) = rule {
                match &g.grid {
                    GridDefinition::Table { query, .. } => {
                        queries.insert(
                            (g.id.clone(), "table".into()),
                            crate::grid_query::GridQuery::prepare(
                                language.prepared().schema(),
                                query,
                            )?,
                        );
                    }
                    GridDefinition::Matrix { rows, columns, .. } => {
                        for (role, axis) in [("rows", rows), ("columns", columns)] {
                            queries.insert(
                                (g.id.clone(), role.into()),
                                crate::grid_query::GridQuery::prepare(
                                    language.prepared().schema(),
                                    &axis.query,
                                )?,
                            );
                        }
                    }
                }
            }
        }
        let result = Self {
            functions,
            rules,
            queries,
        };
        result.validate(language)?;
        Ok(result)
    }
    fn require(
        &self,
        language: &Language,
        name: &str,
        owner: &str,
        origin: &str,
        want_elements: bool,
    ) -> Result<Option<String>, String> {
        let function = self
            .functions
            .get(name)
            .ok_or_else(|| format!("Rule {origin}: unknown function {name}"))?;
        let actual = language
            .metamodel
            .class(owner)
            .ok_or_else(|| format!("Rule {origin}: unknown class {owner}"))?;
        let receiver = language
            .metamodel
            .class(&function.receiver)
            .ok_or("Unknown receiver class")?;
        if !language.metamodel.is_a(actual, receiver) {
            return Err(format!(
                "Rule {origin}, function {name}: parameter {} is incompatible with {owner}",
                function.receiver
            ));
        }
        match (&function.output, want_elements) {
            (Output::Elements(class), true) => Ok(Some(class.clone())),
            (Output::String, false) => Ok(None),
            _ => Err(format!(
                "Rule {origin}, function {name}: incompatible result type"
            )),
        }
    }
    fn slot(
        &self,
        language: &Language,
        slot: Option<&Slot>,
        owner: &str,
        origin: &str,
    ) -> Result<(), String> {
        if let Some(Slot::Function(name)) = slot {
            self.require(language, name, owner, origin, false)?;
        }
        Ok(())
    }
    pub(crate) fn validate(&self, language: &Language) -> Result<(), String> {
        for rules in &self.rules {
            if let RuleSet::LaneGraph(r) = rules {
                let g = &r.lane_graph;
                let origin = &r.id;
                let lane = self
                    .require(
                        language,
                        &g.container.lanes,
                        &g.container.class,
                        origin,
                        true,
                    )?
                    .ok_or("Missing lane result")?;
                let step = self
                    .require(
                        language,
                        &g.container.steps,
                        &g.container.class,
                        origin,
                        true,
                    )?
                    .ok_or("Missing Step result")?;
                let conforms = |actual: &str, required: &str| -> Result<(), String> {
                    let a = language
                        .metamodel
                        .class(actual)
                        .ok_or("Missing lane result class")?;
                    let b = language
                        .metamodel
                        .class(required)
                        .ok_or("Missing lane target class")?;
                    if language.metamodel.is_a(a, b) {
                        Ok(())
                    } else {
                        Err("Incompatible lane selector result class".into())
                    }
                };
                for (name, expected) in [
                    (&g.step.lane, &lane),
                    (&g.step.across, &lane),
                    (&g.step.after, &step),
                    (&g.step.end, &step),
                ] {
                    conforms(
                        &self
                            .require(language, name, &step, origin, true)?
                            .ok_or("Missing lane selector result")?,
                        expected,
                    )?;
                }
                self.label_slot(language, Some(&g.lane.label), &lane, origin)?;
                self.label_slot(language, Some(&g.step.label), &step, origin)?;
                if let Some(e) = &g.edit {
                    self.predicate(language, &e.accepts, Some(&step), origin)?;
                }
                continue;
            }
            let RuleSet::Graph(rules) = rules else {
                if let RuleSet::Grid(g) = rules {
                    self.validate_grid(language, g)?;
                }
                continue;
            };
            for rule in &rules.symbols {
                if language.metamodel.class(&rule.class).is_none() {
                    return Err(format!("Rule {}: unknown class {}", rule.id, rule.class));
                }
                self.symbol(language, rules, rule)?;
            }
            for edge in &rules.edges {
                if let Some(connect) = edge.connect() {
                    // Endpoint predicates may accept a narrower model class (e.g.
                    // Pin). Other endpoint classes are inapplicable at runtime.
                    for name in [&connect.source_accepts, &connect.target_accepts] {
                        self.predicate(language, name, None, edge.id())?;
                    }
                }
                match edge {
                    EdgeRule::Element {
                        id,
                        per,
                        select,
                        label,
                        source_path,
                        target_path,
                        ..
                    } => {
                        let owner = &rules
                            .symbols
                            .iter()
                            .find(|r| r.id == *per)
                            .ok_or("Missing edge owner rule")?
                            .class;
                        let edge_class = self
                            .require(language, select, owner, id, true)?
                            .ok_or("Missing edge class")?;
                        for path in [source_path, target_path] {
                            self.require(language, path, &edge_class, id, true)?;
                        }
                        self.label_slot(language, Some(label), &edge_class, id)?;
                        for marker in edge.markers().into_iter().flatten() {
                            self.graphic_slot(language, Some(marker), &edge_class, id)?;
                        }
                    }
                    EdgeRule::Reference {
                        id,
                        per,
                        targets,
                        label,
                        ..
                    } => {
                        let owner = &rules
                            .symbols
                            .iter()
                            .find(|r| r.id == *per)
                            .ok_or("Missing reference owner rule")?
                            .class;
                        self.require(language, targets, owner, id, true)?;
                        self.label_slot(language, Some(label), owner, id)?;
                        for marker in edge.markers().into_iter().flatten() {
                            self.graphic_slot(language, Some(marker), owner, id)?;
                        }
                    }
                }
            }
        }
        Ok(())
    }
    fn label_slot(
        &self,
        language: &Language,
        label: Option<&LabelRule>,
        owner: &str,
        origin: &str,
    ) -> Result<(), String> {
        if let Some(label) = label {
            match label {
                LabelRule::Scalar(s) => self.slot(language, Some(s), owner, origin)?,
                LabelRule::Parts(r) => {
                    for p in &r.parts {
                        if let Some(w) = &p.when {
                            self.predicate(language, w, Some(owner), origin)?;
                        }
                        let subject = match &p.subject {
                            Subject::This => owner.to_owned(),
                            Subject::None => continue,
                            Subject::Select { select } => self
                                .require(language, select, owner, origin, true)?
                                .ok_or("Missing label subject class")?,
                        };
                        self.slot(language, Some(&p.text), &subject, origin)?;
                        if let Some(e) = &p.edit {
                            self.predicate(language, &e.accepts, Some(&subject), origin)?;
                        }
                    }
                }
            }
        }
        Ok(())
    }
    fn symbol(
        &self,
        language: &Language,
        rules: &GraphRuleSet,
        rule: &SymbolRule,
    ) -> Result<(), String> {
        self.graphic_slot(language, rule.graphic.as_ref(), &rule.class, &rule.id)?;
        for create in &rule.create {
            self.predicate(language, &create.accepts, Some(&rule.class), &rule.id)?;
        }
        for slot in [&rule.title, &rule.subtitle, &rule.label] {
            self.label_slot(language, slot.as_ref(), &rule.class, &rule.id)?;
        }
        for slot in [&rule.side, &rule.style_class] {
            self.slot(language, slot.as_ref(), &rule.class, &rule.id)?;
        }
        if let Some(r) = &rule.regions {
            let class = self
                .require(language, &r.select, &rule.class, &r.id, true)?
                .ok_or("Missing region class")?;
            self.label_slot(language, Some(&r.label), &class, &r.id)?;
            self.require(language, &r.children.select, &class, &r.id, true)?;
        }
        if rule.emit == "port" && rule.side.is_none() {
            return Err(format!("Port rule {} requires a side", rule.id));
        }
        for c in &rule.compartments {
            let row_class = self
                .require(language, &c.rows, &rule.class, &rule.id, true)?
                .ok_or("Missing row class")?;
            self.label_slot(language, Some(&c.row_label), &row_class, &rule.id)?;
        }
        if let Some(ports) = &rule.ports {
            let actual = self
                .require(language, &ports.select, &rule.class, &rule.id, true)?
                .ok_or("Missing port result")?;
            let required = &rules
                .symbols
                .iter()
                .find(|r| r.id == ports.rule)
                .ok_or("Unknown port rule")?
                .class;
            let actual = language
                .metamodel
                .class(&actual)
                .ok_or("Unknown port result class")?;
            let required = language
                .metamodel
                .class(required)
                .ok_or("Unknown port match class")?;
            if !language.metamodel.is_a(actual, required) {
                return Err(format!(
                    "Rule {}, function {}: incompatible port class",
                    rule.id, ports.select
                ));
            }
        }
        if let Some(children) = &rule.children {
            self.require(language, &children.select, &rule.class, &rule.id, true)?;
        }
        for option in &rule.expand {
            self.require(language, &option.select, &rule.class, &rule.id, true)?;
        }
        Ok(())
    }
    fn graphic_slot(
        &self,
        language: &Language,
        rule: Option<&intersect_views::GraphicRule>,
        owner: &str,
        origin: &str,
    ) -> Result<(), String> {
        if let Some(rule) = rule {
            for parameter in rule.parameters.values() {
                match parameter {
                    intersect_views::ParameterRule::String { value } => {
                        self.slot(language, Some(value), owner, origin)?
                    }
                    intersect_views::ParameterRule::Bool { function } => {
                        self.predicate(language, function, Some(owner), origin)?
                    }
                    _ => {}
                }
            }
            for block in rule.text.values() {
                for run in &block.runs {
                    self.label_slot(language, Some(&run.label), owner, origin)?;
                }
            }
        }
        Ok(())
    }
    fn predicate(
        &self,
        language: &Language,
        name: &str,
        owner: Option<&str>,
        origin: &str,
    ) -> Result<(), String> {
        let f = self
            .functions
            .get(name)
            .ok_or_else(|| format!("Rule {origin}: unknown predicate {name}"))?;
        if f.output != Output::Boolean {
            return Err(format!(
                "Rule {origin}, function {name}: predicate must return Bool"
            ));
        }
        if let Some(owner) = owner {
            let actual = language
                .metamodel
                .class(owner)
                .ok_or("Missing predicate owner class")?;
            let receiver = language
                .metamodel
                .class(&f.receiver)
                .ok_or("Missing predicate receiver class")?;
            if !language.metamodel.is_a(actual, receiver) {
                return Err(format!(
                    "Rule {origin}, function {name}: incompatible predicate receiver"
                ));
            }
        }
        Ok(())
    }
}
