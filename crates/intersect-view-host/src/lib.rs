//! Handwritten language-neutral host: loading, graph views and isolated source edits.
pub const SOURCE_IDENTITY: &str = env!("INTERSECT_VIEW_HOST_SOURCE_IDENTITY");
mod editing;
pub mod grid_query;
mod grids;
mod identity;
mod integration;
mod labels;
mod lanes;
mod language;
pub mod load;
mod positions;
mod presentation;
mod project_model;
mod runtime;
mod scenes;
mod transport;
pub use editing::{insert_member, source_patch};
pub use identity::key as element_key;
pub use integration::{
    LoadedModel, LoadedSources, ModelView, ModelViewContext, ModelViews, ProjectLoad,
    ProjectMetadata, SourceLoader,
};
use intersect_model::{
    core::{
        frozen::{FrozenStore, Metamodel, Model, ValueRef},
        query::QueryBudget,
        storage::{ModelStore, atomic},
    },
    definitions::{bundle::DefinitionSource, rcore_scope::VerifiedScope},
    frozen_scopes::RcoreScopes,
};
pub use intersect_text::Source;
use intersect_text::{
    EvaluationLimits,
    document::AnalysisLimits,
    draft::{DraftLanguage, GrammarPolicy, OpenDraftCapability},
    preparation::PreparedLanguageDefinition,
};
use intersect_views::{MAX_WIRE_INTEGER, Position, PrepareCommand, SourcePatch};
pub use language::{LanguageDefinition, PreparedLanguageProvider};
use project_model::AcceptedModel;
pub use project_model::{ProjectModel, ProjectObject};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    cell::OnceCell,
    collections::{BTreeMap, BTreeSet},
    rc::Rc,
    sync::Arc,
};
pub use transport::WasmTransport;

/// Language-owned source generator. The host supplies the rule-authorized command ID.
pub struct CommandContext<'a> {
    pub model: ProjectModel<'a>,
    pub sources: &'a BTreeMap<String, String>,
    pub revision: u64,
    pub command: &'a str,
    pub scene: &'a intersect_views::Scene,
    pub keys: &'a BTreeMap<String, String>,
    pub grid_target: Option<GridCommandTarget<'a>>,
    pub lane_target: Option<LaneCommandTarget<'a>>,
    pub label_target: Option<LabelCommandTarget<'a>>,
    pub functions: &'a ModelViewContext<'a>,
}
#[derive(Clone, Copy)]
pub struct LabelCommandTarget<'a> {
    pub owner_symbol: &'a str,
    pub owner_binding: &'a intersect_views::Binding,
    pub slot: &'a str,
    pub part: &'a intersect_views::LabelPart,
}
pub struct LaneCommandTarget<'a> {
    pub step: &'a intersect_views::LaneStep,
    pub lane: &'a intersect_views::Lane,
    pub before: Option<&'a intersect_views::LaneStep>,
    pub end: Option<&'a intersect_views::LaneStep>,
    pub container_binding: intersect_views::Binding,
    pub ordered: Vec<&'a intersect_views::Binding>,
}
pub struct GridCommandTarget<'a> {
    pub row: &'a intersect_views::AxisEntry,
    pub column: &'a intersect_views::AxisEntry,
    pub member: Option<&'a intersect_views::GridMember>,
}
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub element_key: Option<String>,
}
impl CommandError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            feature: None,
            element_key: None,
        }
    }
}
pub trait Commands {
    fn supports(&self, command: &str) -> bool;
    fn prepare(
        &self,
        context: &CommandContext<'_>,
        command: &PrepareCommand,
    ) -> Result<Vec<SourcePatch>, CommandError>;
}
pub struct NoCommands;
impl Commands for NoCommands {
    fn supports(&self, _: &str) -> bool {
        false
    }
    fn prepare(
        &self,
        _: &CommandContext<'_>,
        _: &PrepareCommand,
    ) -> Result<Vec<SourcePatch>, CommandError> {
        Err(CommandError::new("unsupported", "Read-only host"))
    }
}
type SceneKeys = BTreeMap<String, Option<intersect_view_engine::ElementId>>;

pub(crate) struct Snapshot {
    accepted: AcceptedModel,
    keys: BTreeMap<String, String>,
    objects: BTreeMap<usize, intersect_model::core::frozen::ObjId>,
    scene_keys: OnceCell<Result<SceneKeys, String>>,
}
impl Snapshot {
    fn model(&self) -> ProjectModel<'_> {
        self.accepted.project()
    }
}
pub struct Host {
    initialized: bool,
    presentation: Option<presentation::PreparedPresentation>,
    language: runtime::Runtime,
    commands: Box<dyn Commands>,
    current: Option<Snapshot>,
    sources: BTreeMap<String, String>,
    reference_sources: BTreeMap<String, String>,
    loader: Option<Box<dyn SourceLoader>>,
    model_views: Option<Box<dyn ModelViews>>,
    project_nodes_only: bool,
    editable: BTreeSet<String>,
    navigation: Vec<intersect_text::Reference>,
    revision: u64,
    pending: Option<editing::Pending>,
    project_epoch: Rc<()>,
    next_transaction: u64,
}
/// An isolated analysis result ready for publication by the host that made it.
/// A new project analysis or committed edit makes the result stale.
pub struct PreparedProject {
    base: Rc<()>,
    candidate: editing::Candidate,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProjectRequest {
    sources: Vec<Source>,
    revision: u64,
    #[serde(default)]
    project_nodes_only: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InitializeRequest {
    protocol_version: u32,
}

/// Public M0-compatible adapter, now shared by the generic loader and harness.
pub fn function_store(model: Model) -> Result<FrozenStore, String> {
    let mut store = FrozenStore::from_model(model);
    let revision = store.metamodel().revision().to_owned();
    atomic(&mut store, |store| store.set_revision(&revision))?;
    Ok(store)
}
/// Load a prepared definition with one explicitly supplied bindings source.
/// This lets fixture consumers use exactly the host's loading implementation.
pub fn load_prepared(
    definition: &PreparedLanguageDefinition<'_>,
    bindings: &DefinitionSource,
    sources: &[Source],
) -> Result<load::FrozenLoad, String> {
    let mm = Arc::new(Metamodel::freeze(definition.schema()).map_err(|e| e.to_string())?);
    let mut bundle = definition.sources().clone();
    if !bundle.sources.iter().any(|s| s.id == bindings.id) {
        bundle.sources.push(bindings.clone());
    }
    let scopes = language::compile_scopes(&bundle, bindings)?;
    load_with_scopes(definition, mm, &bundle, &scopes, sources)
}
fn load_with_scopes(
    definition: &PreparedLanguageDefinition<'_>,
    mm: Arc<Metamodel>,
    bundle: &intersect_model::definitions::bundle::DefinitionBundle,
    scopes: &[VerifiedScope],
    sources: &[Source],
) -> Result<load::FrozenLoad, String> {
    let inner = GrammarPolicy::new(definition);
    let capability = OpenDraftCapability::new(definition, &inner)?;
    let mut limits = AnalysisLimits::workbench();
    limits.total_source_bytes = 8 * 1024 * 1024;
    limits.tree.source_bytes = 8 * 1024 * 1024;
    let language = DraftLanguage::bind(definition, &capability, limits)?;
    let resolvers = RcoreScopes::new(&mm, bundle, scopes).map_err(|e| e.to_string())?;
    let mut budget = QueryBudget::new(100_000_000);
    load::load_frozen(
        FrozenStore::new(mm.clone()),
        sources,
        |source, store| {
            language.parse_runtime_into(
                source,
                EvaluationLimits {
                    resources: Some(256),
                    input_bytes: Some(8 * 1024 * 1024),
                    steps_per_resource: Some(50_000_000),
                    ..EvaluationLimits::native()
                },
                store,
                &mut budget,
            )
        },
        &resolvers,
        &|_| {},
    )
}
impl Host {
    /// Borrow the compiler-owned definition for fixture probes and adapters.
    /// It cannot escape this callback; the host retains its original sources.
    pub fn with_definition<T>(
        &self,
        consume: impl FnOnce(&PreparedLanguageDefinition<'_>) -> Result<T, String>,
    ) -> Result<T, String> {
        consume(self.language.prepared())
    }
    pub fn new(language: LanguageDefinition, commands: Box<dyn Commands>) -> Result<Self, String> {
        Ok(Self {
            language: runtime::Runtime::prepare(language)?,
            initialized: false,
            presentation: None,
            commands,
            current: None,
            sources: BTreeMap::new(),
            reference_sources: BTreeMap::new(),
            loader: None,
            model_views: None,
            project_nodes_only: false,
            editable: BTreeSet::new(),
            navigation: vec![],
            revision: 0,
            pending: None,
            project_epoch: Rc::new(()),
            next_transaction: 0,
        })
    }
    /// Bind views to a language-owned checked definition and project loader.
    /// No grammar is compiled and no pack cache is deserialized here.
    pub fn from_prepared(
        language: LanguageDefinition,
        provider: Box<dyn PreparedLanguageProvider>,
        metamodel: Arc<Metamodel>,
        loader: Box<dyn SourceLoader>,
        commands: Box<dyn Commands>,
    ) -> Result<Self, String> {
        Ok(Self {
            language: runtime::Runtime::from_language(language::Language::from_prepared(
                language, provider, metamodel,
            )?)?,
            initialized: false,
            presentation: None,
            commands,
            current: None,
            sources: BTreeMap::new(),
            reference_sources: BTreeMap::new(),
            loader: Some(loader),
            model_views: None,
            project_nodes_only: false,
            editable: BTreeSet::new(),
            navigation: vec![],
            revision: 0,
            pending: None,
            project_epoch: Rc::new(()),
            next_transaction: 0,
        })
    }
    fn source_text(&self, uri: &str) -> Option<&String> {
        self.sources
            .get(uri)
            .or_else(|| self.reference_sources.get(uri))
    }
    pub fn source(&self, uri: &str) -> Option<&str> {
        self.source_text(uri).map(String::as_str)
    }
    pub fn sources(&self) -> &BTreeMap<String, String> {
        &self.sources
    }
    pub fn with_model_views(mut self, provider: Box<dyn ModelViews>) -> Self {
        self.model_views = Some(provider);
        self
    }
    /// Accepted state for a compatibility facade's other language services.
    pub fn accepted_model(&self) -> Option<&Model> {
        self.current.as_ref().and_then(|s| s.model().frozen())
    }
    pub fn accepted_project(&self) -> Option<ProjectModel<'_>> {
        self.current.as_ref().map(Snapshot::model)
    }
    pub fn navigation(&self) -> &[intersect_text::Reference] {
        &self.navigation
    }
    pub fn view_catalog(&self, revision: u64) -> Result<intersect_views::ViewCatalog, String> {
        self.check_revision(&json!({"revision":revision}))?;
        serde_json::from_value(self.views_catalog()?).map_err(|e| e.to_string())
    }
    pub fn view_scene(
        &self,
        revision: u64,
        key: &str,
        scope: Option<&intersect_views::Scope>,
        palette: Option<intersect_views::Palette>,
    ) -> Result<intersect_views::SceneResponse, String> {
        self.check_revision(&json!({"revision":revision}))?;
        self.scene_response(key, scope, palette)
    }
    pub fn dispatch(&mut self, request: Value) -> Result<Value, String> {
        let method = request["method"]
            .as_str()
            .ok_or("Request has no method")?
            .to_string();
        let checked = self.presentation.is_some()
            && method.starts_with("views/")
            && method != "views/preparePresentation";
        let fingerprint = self.presentation_context().fingerprint;
        let supplied = request["params"]["presentationFingerprint"].as_str();
        if (checked && supplied != Some(fingerprint.as_str()))
            || supplied.is_some_and(|s| s != fingerprint)
        {
            return Err("Presentation context changed; replace or refresh the host/session".into());
        }
        let mut request = request;
        if let Some(params) = request["params"].as_object_mut() {
            params.remove("presentationFingerprint");
        }
        let mut response = self.dispatch_inner(request)?;
        // A package-scoped abort still acknowledges its context after clearing
        // the pending candidate. The unscoped protocol retains its null reply.
        if checked && method == "views/abortCommand" && response.is_null() {
            response = json!({});
        }
        if checked && method != "views/scene" {
            let object = response
                .as_object_mut()
                .ok_or("Expected a presentation response object")?;
            object.insert("presentationFingerprint".into(), fingerprint.into());
        }
        Ok(response)
    }
    fn dispatch_inner(&mut self, request: Value) -> Result<Value, String> {
        let method = request["method"].as_str().ok_or("Request has no method")?;
        let params = &request["params"];
        match method {
            "initialize" => {
                let request: InitializeRequest = serde_json::from_value(params.clone())
                    .map_err(|e| format!("Protocol v2 initialization required: {e}"))?;
                if request.protocol_version != 2 {
                    return Err("Unsupported client protocol; version 2 required".into());
                }
                let fingerprint = self.language_fingerprint()?;
                self.initialized = true;
                Ok(
                    json!({"protocolVersion":2,"language":{"id":self.language.definition.id,"name":self.language.definition.name,"fileExtensions":self.language.definition.file_extensions,"namespace":self.language.definition.namespace,"fingerprint":fingerprint},"capabilities":{"positionEncoding":"utf-16","sceneVersion":intersect_views::VERSION,"presentationVersion":intersect_views::PRESENTATION_VERSION,"presentation":intersect_views::PRESENTATION_CAPABILITIES},"serverInfo":{"name":"Intersect view host","version":env!("CARGO_PKG_VERSION")}}),
                )
            }
            "views/preparePresentation" => self.prepare_presentation(params),
            "workspace/analyze" => {
                self.invalidate();
                self.sources.clear();
                self.editable.clear();
                let request: ProjectRequest = serde_json::from_value(params.clone())
                    .map_err(|e| format!("Invalid workspace request: {e}"))?;
                self.analyze(request)
            }
            "intersect/inspect" => {
                self.check_optional_revision(params)?;
                self.inspect(params)
            }
            "intersect/source" => {
                self.check_optional_revision(params)?;
                let uri = params["uri"].as_str().ok_or("Missing source URI")?;
                Ok(
                    json!({"uri":uri,"text":self.source_text(uri).ok_or_else(||format!("No source text for {uri}"))?}),
                )
            }
            "views/locate" => {
                self.check_revision(params)?;
                self.locate(params)
            }
            "views/catalog" => {
                self.check_revision(params)?;
                self.views_catalog()
            }
            "views/rendering" => self.views_rendering(params),
            "views/scene" => {
                self.check_revision(params)?;
                self.views_scene(params)
            }
            "views/targets" => {
                self.check_revision(params)?;
                self.views_targets(params)
            }
            "views/laneTargets" => self.lane_targets(params),
            "views/labelTargets" => {
                self.check_revision(params)?;
                self.label_targets(params)
            }
            "views/gridTargets" => {
                self.check_revision(params)?;
                self.grid_targets(params)
            }
            "views/prepareCommand" => {
                let result = self.prepare_command(params);
                match result {
                    Ok(value) => Ok(value),
                    Err(error) => serde_json::to_value(error).map_err(|e| e.to_string()),
                }
            }
            "views/commitCommand" => self.commit_command(params),
            "views/abortCommand" => {
                if self
                    .pending
                    .as_ref()
                    .is_some_and(|p| params["token"].as_str() == Some(p.token.as_str()))
                {
                    self.pending = None;
                }
                Ok(Value::Null)
            }
            "views/ruleSets" => Ok(
                json!({"ruleSets":self.language.cache().rules.iter().map(|r|json!({"id":r.id(),"label":r.label()})).collect::<Vec<_>>()}),
            ),
            "views/notation" => {
                if let Some(notation) = self.presentation.as_ref().and_then(|p| p.notation.as_ref())
                {
                    return serde_json::to_value(notation).map_err(|e| e.to_string());
                }
                if self.language.definition.notation.is_empty() {
                    Ok(Value::Null)
                } else {
                    serde_json::from_str(&self.language.definition.notation)
                        .map_err(|e| format!("Invalid notation: {e}"))
                }
            }
            "shutdown" => {
                self.invalidate();
                self.sources.clear();
                self.editable.clear();
                Ok(Value::Null)
            }
            _ => Err(format!("Unsupported language method: {method}")),
        }
    }
    /// Revoke accepted model services and pending edits before an enclosing
    /// facade changes its language-owned project environment.
    pub fn invalidate(&mut self) {
        self.project_epoch = Rc::new(());
        self.pending = None;
        self.current = None;
        self.navigation.clear();
        self.reference_sources.clear();
    }
    fn check_revision(&self, params: &Value) -> Result<(), String> {
        if params["revision"].as_u64() != Some(self.revision) {
            Err("Language model is stale; wait for the current analysis".into())
        } else {
            Ok(())
        }
    }
    fn check_optional_revision(&self, params: &Value) -> Result<(), String> {
        if params.get("revision").is_some() {
            self.check_revision(params)
        } else {
            Ok(())
        }
    }
    fn snapshot(&self) -> Result<&Snapshot, String> {
        let snapshot = self
            .current
            .as_ref()
            .ok_or("No accepted model; wait for a clean analysis")?;
        if snapshot.accepted.reader().revision()? != snapshot.model().metamodel().revision() {
            return Err("Accepted model store has a different schema revision".into());
        }
        Ok(snapshot)
    }
    fn analyze(&mut self, request: ProjectRequest) -> Result<Value, String> {
        if request.revision > MAX_WIRE_INTEGER {
            return Err("Revision exceeds the portable JSON integer range".into());
        }
        self.revision = request.revision;
        let candidate = self.candidate(request)?;
        Ok(self.publish(candidate))
    }
    /// Analyze the supplied buffers with the current loader without changing
    /// the accepted model, sources, or edit state.
    pub fn prepare_project(
        &self,
        revision: u64,
        sources: Vec<Source>,
        project_nodes_only: bool,
    ) -> Result<PreparedProject, String> {
        let candidate = self.candidate(ProjectRequest {
            revision,
            sources,
            project_nodes_only,
        })?;
        Ok(PreparedProject {
            base: self.project_epoch.clone(),
            candidate,
        })
    }

    /// Publish a candidate from the current session and analysis epoch.
    /// A checked result with diagnostics still publishes its source buffers.
    pub fn adopt_project(&mut self, prepared: PreparedProject) -> Result<Value, String> {
        if !Rc::ptr_eq(&prepared.base, &self.project_epoch) {
            return Err("Prepared project is stale or belongs to another host".into());
        }
        self.pending = None;
        Ok(self.publish(prepared.candidate))
    }

    /// Analyze and adopt in one call. Operational failures leave the accepted
    /// revision, source buffers and any prepared edit intact.
    pub fn analyze_project(
        &mut self,
        revision: u64,
        sources: Vec<Source>,
        project_nodes_only: bool,
    ) -> Result<Value, String> {
        let prepared = self.prepare_project(revision, sources, project_nodes_only)?;
        self.adopt_project(prepared)
    }
    fn publish(&mut self, candidate: editing::Candidate) -> Value {
        self.project_epoch = Rc::new(());
        self.revision = candidate.revision;
        self.current = candidate.snapshot;
        self.sources = candidate.sources;
        self.reference_sources = candidate.reference_sources;
        self.project_nodes_only = candidate.project_nodes_only;
        self.editable = candidate.editable;
        self.navigation = if self.current.is_some() {
            candidate.navigation
        } else {
            vec![]
        };
        candidate.analysis
    }
    fn candidate(&self, request: ProjectRequest) -> Result<editing::Candidate, String> {
        if request.revision > MAX_WIRE_INTEGER {
            return Err("Revision exceeds the portable JSON integer range".into());
        }
        if request.sources.len() > 256
            || request
                .sources
                .iter()
                .try_fold(0usize, |sum, s| sum.checked_add(s.text.len()))
                .is_none_or(|size| size > 8 * 1024 * 1024)
        {
            return Err("Workspace exceeds 256 sources or 8 MiB of model text".into());
        }
        let mut seen = BTreeSet::new();
        for source in &request.sources {
            if source.uri.is_empty() {
                return Err("Source URI is empty".into());
            }
            if !seen.insert(&source.uri) {
                return Err(format!("Duplicate source URI: {}", source.uri));
            }
        }
        let all_sources: BTreeMap<String, String> = request
            .sources
            .iter()
            .map(|s| (s.uri.clone(), s.text.clone()))
            .collect();
        let sources: Vec<_> = request
            .sources
            .into_iter()
            .filter(|s| self.language.is_model_source(&s.uri))
            .collect();
        let editable: BTreeSet<String> = sources.iter().map(|s| s.uri.clone()).collect();
        let LoadedSources {
            load: loaded,
            reference_sources,
            metadata,
        } = if let Some(loader) = &self.loader {
            loader.load(&sources)?
        } else {
            LoadedSources {
                load: load_with_scopes(
                    self.language.prepared(),
                    self.language.metamodel.clone(),
                    &self.language.bundle,
                    &self.language.scopes,
                    &sources,
                )?
                .into(),
                reference_sources: BTreeMap::new(),
                metadata: ProjectMetadata::default(),
            }
        };
        if reference_sources
            .keys()
            .any(|uri| all_sources.contains_key(uri))
        {
            return Err("Read-only source collides with a project buffer".into());
        }
        let loaded_model = loaded.model.as_ref().map(LoadedModel::project);
        if let Some(model) = loaded_model
            && model.metamodel().digest().map_err(|e| e.to_string())?
                != self
                    .language
                    .metamodel
                    .digest()
                    .map_err(|e| e.to_string())?
        {
            return Err("Loaded model uses a different prepared metamodel".into());
        }
        let clean = loaded.is_clean();
        let has_model = loaded.model.is_some();
        let diagnostics:Vec<_>=loaded.diagnostics.iter().map(|d|{
            let object=d.object.as_deref().and_then(|id|loaded_model?.lookup(id));
            let uri=d.resource.as_deref().or_else(||object.map(|o|o.resource()));
            let span=object.map(|o|o.span());let text=uri.and_then(|u|all_sources.get(u).or_else(||reference_sources.get(u))).map_or("",String::as_str);
            let range=positions::range(text,d.start.or_else(||span.map(|s|s.0)).unwrap_or(0),d.end.or_else(||span.map(|s|s.1)).unwrap_or(0));
            json!({"uri":uri,"message":d.message,"code":d.code,"phase":d.phase,"severity":d.severity,"feature":d.feature,"rule":d.rule,"range":range})
        }).collect();
        let rejection = loaded
            .diagnostics
            .iter()
            .find(|d| d.is_error())
            .map(|d| CommandError {
                code: d
                    .code
                    .clone()
                    .unwrap_or_else(|| format!("candidate.{:?}", d.phase).to_lowercase()),
                message: d.message.clone(),
                feature: d.feature.clone(),
                element_key: d
                    .object
                    .as_deref()
                    .and_then(|id| loaded_model?.lookup(id))
                    .and_then(|o| {
                        identity::key(o, &self.language.definition.name_features, &[]).ok()
                    }),
            });
        let mut snapshot = None;
        let mut nodes = vec![];
        if clean {
            let model = loaded.model.ok_or("Clean load has no model")?;
            let keys = identity::catalog(
                model.project(),
                &self.language.definition.name_features,
                &editable,
            )?;
            nodes = self.model_nodes(
                model.project(),
                request.project_nodes_only.then_some(&editable),
            );
            let objects = model
                .project()
                .objects()
                .map(|object| (object.id().index(), object.id()))
                .collect();
            let accepted = match model {
                LoadedModel::Frozen(model) => {
                    let store = Box::new(function_store(model.as_ref().clone())?);
                    AcceptedModel::Frozen { model, store }
                }
                LoadedModel::Mounted(model) => AcceptedModel::Mounted(model),
            };
            snapshot = Some(Snapshot {
                accepted,
                keys,
                objects,
                scene_keys: OnceCell::new(),
            });
        }
        let analysis = json!({"revision":request.revision,"nodes":nodes,"diagnostics":diagnostics,"hasModel":has_model,"clean":clean,"resolved":loaded.resolved,"references":loaded.references,"project":metadata.project,"dependencyUris":metadata.dependency_uris,"dependencies":metadata.dependencies,"notes":metadata.notes});
        Ok(editing::Candidate {
            revision: request.revision,
            snapshot,
            sources: all_sources,
            reference_sources,
            project_nodes_only: request.project_nodes_only,
            editable,
            navigation: loaded.navigation,
            analysis,
            rejection,
        })
    }
    fn model_nodes(
        &self,
        model: ProjectModel<'_>,
        resources: Option<&BTreeSet<String>>,
    ) -> Vec<Value> {
        model.objects().filter(|o|resources.is_none_or(|r|r.contains(o.resource()))).filter_map(|object|{
            let name=identity::name(object,&self.language.definition.name_features)?;
            let mut parent=object.container();
            while let Some(owner)=parent{if identity::name(owner,&self.language.definition.name_features).is_some(){break;}parent=owner.container();}
            let(start,end)=object.span();Some(json!({"id":object.identity(),"name":name,"class":object.class_key(),"parent":parent.map(|p|p.identity()),"uri":object.resource(),"start":start,"end":end}))
        }).collect()
    }
    fn inspect(&self, params: &Value) -> Result<Value, String> {
        let snapshot = self.snapshot()?;
        let project = snapshot.model();
        let id = params["id"].as_str().ok_or("Missing element id")?;
        if let Some(data) = project.lookup(id).and_then(ProjectObject::mounted_view) {
            let values: BTreeMap<_, _> = data
                .fields()
                .map(|(name, value)| (name, self.mounted_value_json(project, value)))
                .collect();
            let text = self.source_text(data.resource()).map_or("", String::as_str);
            let range = positions::range(text, data.start(), data.end());
            return Ok(
                json!({"id":id,"class":data.class(),"resource":data.resource(),"range":range,"values":values,"revision":self.revision}),
            );
        }
        let model = project
            .frozen()
            .ok_or("Element no longer exists in the current model")?;
        let object = model
            .lookup(id)
            .ok_or("Element no longer exists in the current model")?;
        let info = model
            .metamodel()
            .class_info(object.class())
            .ok_or("Missing class metadata")?;
        let values: BTreeMap<_, _> = info
            .stored
            .iter()
            .filter_map(|f| {
                object.get(*f).map(|v| {
                    (
                        model.metamodel().feature_name(*f),
                        self.value_json(model, v),
                    )
                })
            })
            .collect();
        let (start, end) = object.span();
        let text = self
            .source_text(object.resource())
            .map_or("", String::as_str);
        Ok(
            json!({"id":id,"class":object.class_key(),"resource":object.resource(),"range":positions::range(text,start,end),"values":values,"revision":self.revision}),
        )
    }
    fn value_json(&self, model: &Model, value: ValueRef<'_>) -> Value {
        match value{
            ValueRef::Default(v)|ValueRef::Json(v)=>v.clone(),ValueRef::Null=>Value::Null,ValueRef::Bool(v)=>json!(v),ValueRef::Int(v)=>json!(v),ValueRef::Str(v)=>json!(v),
            ValueRef::Ref(id)=>model.obj(id).map_or(Value::Null,|o|json!({"$ref":o.identity(),"name":identity::name(o.into(),&self.language.definition.name_features),"class":o.class_key()})),
            ValueRef::Many(items)=>Value::Array(items.iter().map(|v|self.value_json(model,v)).collect()),
        }
    }
    fn mounted_value_json(
        &self,
        project: ProjectModel<'_>,
        value: intersect_model::storage::ValueView<'_>,
    ) -> Value {
        if let Some(items) = value.collection() {
            return Value::Array(
                items
                    .iter()
                    .map(|item| self.mounted_value_json(project, item))
                    .collect(),
            );
        }
        let is_reference = value.reference().is_some();
        let value = value.to_json();
        if is_reference
            && let Some(object) = value.as_str().and_then(|identity| project.lookup(identity))
        {
            return json!({"$ref":object.identity(),"name":identity::name(object,&self.language.definition.name_features),"class":object.class_key()});
        }
        value
    }
    fn locate(&self, params: &Value) -> Result<Value, String> {
        let snapshot = self.snapshot()?;
        let model = snapshot.model();
        let uri = params["uri"].as_str().ok_or("Missing source URI")?;
        let source = self.source_text(uri).ok_or("Unknown source")?;
        let position: Position = serde_json::from_value(params["position"].clone())
            .map_err(|e| format!("Invalid position: {e}"))?;
        let offset = positions::position_byte(source, &position)?;
        let reference = self
            .navigation
            .iter()
            .filter(|r| r.uri == uri && r.start <= offset && offset < r.end)
            .min_by_key(|r| r.end - r.start);
        let object = reference.and_then(|r| model.lookup(&r.target)).or_else(|| {
            model
                .objects()
                .filter(|o| o.resource() == uri && o.span().0 <= offset && offset < o.span().1)
                // A parser may assign a declaration and its anonymous wrapper
                // the same extent. Prefer its configured name among equally
                // small candidates; a smaller anonymous object still wins.
                .min_by_key(|o| {
                    (
                        o.span().1 - o.span().0,
                        identity::name(*o, &self.language.definition.name_features).is_none(),
                    )
                })
        });
        let Some(object) = object else {
            return Ok(Value::Null);
        };
        let text = self
            .source_text(object.resource())
            .map_or("", String::as_str);
        let binding = identity::binding(
            object,
            &self.language.definition.name_features,
            text,
            &self.editable,
            &[],
        )?;
        if identity::name(object, &self.language.definition.name_features).is_some()
            && self.editable.contains(object.resource())
            && snapshot.keys.get(&binding.key).map(String::as_str) != Some(object.identity())
        {
            return Err("Missing named element key".into());
        }
        Ok(json!({"elementId":binding.element_id,"key":binding.key}))
    }
}
