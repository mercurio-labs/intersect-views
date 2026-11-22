//! Handwritten harness registration and M0 probe adapters over the generic host.
use intersect_model::{
    core::frozen::{Model, ObjectIssue},
    definitions::{
        bundle::{DefinitionSource, SourceKind},
        ecore::ParseLimits,
        rcore_behavior::{
            ir_v2::EntrySelection,
            modules::{SymbolKind, index_modules},
        },
    },
};
use intersect_text::preparation::PreparedLanguageDefinition;
use intersect_view_host::{Host, LanguageDefinition, NoCommands};
pub use intersect_view_host::{Source, function_store};
pub const NAMESPACE: &str = "urn:intersect:harness:1";
pub const SOURCE_LIMITS: ParseLimits = ParseLimits {
    source_bytes: 1_000_000,
};
pub const VIEW_FUNCTIONS: &str = include_str!("../language/views.rcore");
mod commands;
mod lane_commands;
pub use commands::HarnessCommands;
intersect_view_host::export_host!(|| intersect_view_host::Host::new(
    crate::definition(),
    Box::new(crate::HarnessCommands)
));

pub fn definition() -> LanguageDefinition {
    let structure = DefinitionSource::new(
        "harness.rcore",
        SourceKind::Rcore,
        include_str!("../language/harness.rcore"),
    );
    let grammar = DefinitionSource::new(
        "harness.xtext",
        SourceKind::Xtext,
        include_str!("../language/harness.xtext"),
    );
    let mut nav = DefinitionSource::new(
        "navigation.rcore",
        SourceKind::RcoreBehavior,
        include_str!("../language/navigation.rcore"),
    );
    nav.dependencies.push(structure.id.clone());
    let mut bindings = DefinitionSource::new(
        "bindings.rcore",
        SourceKind::RcoreBehavior,
        include_str!("../language/bindings.rcore"),
    );
    bindings
        .dependencies
        .extend([structure.id.clone(), nav.id.clone()]);
    let mut views = DefinitionSource::new("views.rcore", SourceKind::RcoreBehavior, VIEW_FUNCTIONS);
    views
        .dependencies
        .extend([structure.id.clone(), nav.id.clone()]);
    LanguageDefinition {
        id: "harness".into(),
        name: "Intersect view harness".into(),
        namespace: NAMESPACE.into(),
        file_extensions: vec!["harness".into()],
        structure,
        grammar,
        bindings,
        view_functions: vec![nav, views],
        extra_functions: vec!["m12Documentation".into(), "boxHasFields".into()],
        view_execution_limits: Default::default(),
        view_function_work: 2_000_000,
        rule_sets: vec![
            include_str!("../views/structure.viewrules.json").into(),
            include_str!("../views/box-table.viewrules.json").into(),
            include_str!("../views/trace-matrix.viewrules.json").into(),
            include_str!("../views/derived-matrix.viewrules.json").into(),
            include_str!("../views/regions.viewrules.json").into(),
            include_str!("../views/regions-column.viewrules.json").into(),
            include_str!("../views/lanes-horizontal.viewrules.json").into(),
            include_str!("../views/lanes-vertical.viewrules.json").into(),
        ],
        notation: include_str!("../views/harness.notation.json").into(),
        palette: include_str!("../views/harness.palette.json").into(),
        name_features: vec!["name".into()],
    }
}
pub fn with_definition<T>(
    consume: impl FnOnce(&PreparedLanguageDefinition<'_>) -> Result<T, String>,
) -> Result<T, String> {
    Host::new(definition(), Box::new(NoCommands))?.with_definition(consume)
}
pub struct Loaded {
    pub model: Model,
    pub issues: Vec<ObjectIssue>,
    pub unresolved_occurrences: usize,
    pub proxies: usize,
}
/// M0/M1's strict fixture surface delegates all pipeline work to the generic host.
pub fn load(
    definition: &PreparedLanguageDefinition<'_>,
    sources: &[Source],
) -> Result<Loaded, String> {
    let structure = definition.selection().ecore.clone();
    let mut bindings = DefinitionSource::new(
        "bindings.rcore",
        SourceKind::RcoreBehavior,
        include_str!("../language/bindings.rcore"),
    );
    bindings.dependencies.push(structure);
    if let Some(nav) = definition
        .sources()
        .sources
        .iter()
        .find(|s| s.id.uri == "navigation.rcore")
    {
        bindings.dependencies.push(nav.id.clone());
    }
    let loaded = intersect_view_host::load_prepared(definition, &bindings, sources)?;
    if loaded
        .diagnostics
        .iter()
        .any(|d| d.phase == intersect_view_host::load::LoadPhase::Parse && d.is_error())
    {
        return Err(format!("Harness parse: {:?}", loaded.diagnostics));
    }
    let model = loaded
        .model
        .ok_or_else(|| format!("Harness load: {:?}", loaded.diagnostics))?;
    Ok(Loaded {
        model,
        issues: loaded.issues,
        unresolved_occurrences: loaded.unresolved_occurrences,
        proxies: loaded.proxies,
    })
}
pub fn view_source(definition: &PreparedLanguageDefinition<'_>, text: &str) -> DefinitionSource {
    let mut source = DefinitionSource::new("views.rcore", SourceKind::RcoreBehavior, text);
    source
        .dependencies
        .push(definition.selection().ecore.clone());
    if let Some(nav) = definition
        .sources()
        .sources
        .iter()
        .find(|s| s.id.uri == "navigation.rcore")
    {
        source.dependencies.push(nav.id.clone());
    }
    source
}
pub fn selection(
    definition: &PreparedLanguageDefinition<'_>,
    source: &DefinitionSource,
    name: &str,
) -> Result<EntrySelection, String> {
    let mut bundle = definition.sources().clone();
    bundle.sources.push(source.clone());
    let index =
        index_modules(&bundle, &source.id).map_err(|e| format!("Index view functions: {e:?}"))?;
    let module = index.module(&source.id)?;
    let matches: Vec<_> = module
        .symbols
        .iter()
        .filter(|s| s.public && s.kind == SymbolKind::Function && s.name.join(".") == name)
        .collect();
    match matches.as_slice() {
        [symbol] => Ok(EntrySelection {
            symbol: symbol.id.clone(),
            types: vec![],
            arguments: vec![],
        }),
        [] => Err(format!("Unknown public view function {name}")),
        _ => Err(format!("Ambiguous public view function {name}")),
    }
}
pub mod probe;
