//! FMEA language package, authored from the qualified harness template.
use intersect_model::definitions::bundle::{DefinitionSource, SourceKind};
use intersect_view_host::LanguageDefinition;
mod commands;
pub use commands::FmeaCommands;
pub fn definition() -> LanguageDefinition {
    let structure = DefinitionSource::new(
        "fmea.rcore",
        SourceKind::Rcore,
        include_str!("../language/fmea.rcore"),
    );
    let grammar = DefinitionSource::new(
        "fmea.xtext",
        SourceKind::Xtext,
        include_str!("../language/fmea.xtext"),
    );
    let mut bindings = DefinitionSource::new(
        "bindings.rcore",
        SourceKind::RcoreBehavior,
        include_str!("../language/bindings.rcore"),
    );
    bindings.dependencies.push(structure.id.clone());
    let mut views = DefinitionSource::new(
        "views.rcore",
        SourceKind::RcoreBehavior,
        include_str!("../language/views.rcore"),
    );
    views.dependencies.push(structure.id.clone());
    LanguageDefinition {
        id: "fmea".into(),
        name: "Failure mode and effects analysis".into(),
        namespace: "urn:intersect:fmea:1".into(),
        file_extensions: vec!["fmea".into()],
        structure,
        grammar,
        bindings,
        view_functions: vec![views],
        extra_functions: vec![],
        view_execution_limits: Default::default(),
        view_function_work: 2_000_000,
        rule_sets: vec![
            include_str!("../views/structure.viewrules.json").into(),
            include_str!("../views/failures.viewrules.json").into(),
            include_str!("../views/actions.viewrules.json").into(),
        ],
        notation: include_str!("../views/fmea.notation.json").into(),
        palette: include_str!("../views/fmea.palette.json").into(),
        name_features: vec!["name".into()],
    }
}
intersect_view_host::export_host!(|| intersect_view_host::Host::new(
    crate::definition(),
    Box::new(crate::FmeaCommands)
));
