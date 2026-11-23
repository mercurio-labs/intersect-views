//! Qualification-only real read-only dependency, through the shared source loader.
use intersect_model::{
    core::frozen::Metamodel, definitions::ecore_migration::BundleMigrationReport,
};
use intersect_text::{
    package::{BundleCompilation, CompilationSourcePolicy},
    preparation::PreparedLanguageDefinition,
};
use intersect_view_host::{
    Host, LoadedSources, NoCommands, PreparedLanguageProvider, ProjectMetadata, Source,
    SourceLoader,
};
use std::{collections::BTreeMap, sync::Arc};
const URI: &str = "library:/symbols.harness";
const TEXT: &str = include_str!("../models/symbols.harness");
struct Provider {
    compilation: BundleCompilation,
    migration: BundleMigrationReport,
}
impl PreparedLanguageProvider for Provider {
    fn prepare(&self) -> Result<PreparedLanguageDefinition<'_>, String> {
        let policy = CompilationSourcePolicy::default();
        intersect_text::compiler::prepare_bundle_with_borrowed_authored_validation(
            &self.compilation,
            &self.migration,
            intersect_text::grammar::Profile::NativeV80,
            &[],
            None,
            policy,
            policy,
            &|_, _, _| Ok(()),
        )
        .map_err(|e| format!("Symbol fixture preparation: {e:?}"))
    }
}
struct Loader {
    language: Host,
}
impl SourceLoader for Loader {
    fn load(&self, sources: &[Source]) -> Result<LoadedSources, String> {
        let mut all = sources.to_vec();
        all.push(Source {
            uri: URI.into(),
            text: TEXT.into(),
        });
        let load = self.language.with_definition(|d| {
            intersect_view_host::load_prepared(d, &crate::definition().bindings, &all)
        })?;
        Ok(LoadedSources {
            load: load.into(),
            reference_sources: BTreeMap::from([(URI.into(), TEXT.into())]),
            metadata: ProjectMetadata {
                dependency_uris: vec![URI.into()],
                ..Default::default()
            },
        })
    }
}
pub fn host() -> Result<Host, String> {
    let definition = crate::definition();
    let language = Host::new(definition.clone(), Box::new(NoCommands))?;
    let (compilation, migration, metamodel) = language.with_definition(|d| {
        Ok((
            d.selection().to_owned(),
            d.migration().clone(),
            Arc::new(Metamodel::freeze(d.schema()).map_err(|e| e.to_string())?),
        ))
    })?;
    Host::from_prepared(
        definition,
        Box::new(Provider {
            compilation,
            migration,
        }),
        metamodel,
        Box::new(Loader { language }),
        Box::new(NoCommands),
    )
}
