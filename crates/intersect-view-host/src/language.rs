//! Handwritten language preparation; no language package dependency or I/O.
use intersect_model::{
    core::frozen::Metamodel,
    definitions::{
        bundle::{DefinitionBundle, DefinitionSource, SourceKind},
        ecore::ParseLimits,
        ecore_migration::BundleMigrationReport,
        rcore_behavior::ir_v2::Limits,
        rcore_scope::{
            BindingKind, VerifiedScope, compile_binding_kinds_with_source_limits,
            source_default_bindings, source_implicit_bindings, source_scope_bindings,
            source_validate_bindings,
        },
    },
};
use intersect_text::{
    grammar::Profile,
    package::{BundleCompilation, CompilationSourcePolicy},
    preparation::PreparedLanguageDefinition,
};
use std::sync::Arc;

/// Authored language inputs. Behavior modules may include shared dependencies
/// (for example navigation imported by both bindings and view functions).
#[derive(Clone)]
pub struct LanguageDefinition {
    pub id: String,
    pub name: String,
    pub namespace: String,
    pub file_extensions: Vec<String>,
    pub structure: DefinitionSource,
    pub grammar: DefinitionSource,
    pub bindings: DefinitionSource,
    pub view_functions: Vec<DefinitionSource>,
    /// Additional unary reads for language-owned catalog and command adapters.
    pub extra_functions: Vec<String>,
    /// Explicit VM limits selected by the language registration, never a request.
    /// Scene/catalog calls additionally share the host's aggregate work budget.
    pub view_execution_limits: intersect_model::rcore::ExecutionLimits,
    /// Aggregate VM/query work per bounded evaluation or predicate pass.
    pub view_function_work: usize,
    pub rule_sets: Vec<String>,
    pub notation: String,
    pub palette: String,
    pub name_features: Vec<String>,
}
impl LanguageDefinition {
    fn validate(&self) -> Result<(), String> {
        if self.id.is_empty()
            || self.name.is_empty()
            || self.namespace.is_empty()
            || self.file_extensions.is_empty()
            || self
                .file_extensions
                .iter()
                .any(|e| e.trim_start_matches('.').is_empty())
        {
            return Err("Language identity and extensions are required".into());
        }
        if !matches!(self.structure.kind, SourceKind::Rcore | SourceKind::Ecore)
            || self.grammar.kind != SourceKind::Xtext
            || self.bindings.kind != SourceKind::RcoreBehavior
            || self
                .view_functions
                .iter()
                .any(|s| s.kind != SourceKind::RcoreBehavior)
        {
            return Err("Unsupported language source kind".into());
        }
        Ok(())
    }
}

/// An application-owned, already checked language owner. The returned view
/// borrows that owner; it is never reconstructed from a raw schema or cache JSON.
pub trait PreparedLanguageProvider {
    fn prepare(&self) -> Result<PreparedLanguageDefinition<'_>, String>;
}
struct AuthoredInputs {
    compilation: BundleCompilation,
    migration: BundleMigrationReport,
}
enum Inputs {
    Authored(Box<AuthoredInputs>),
    External(Box<dyn PreparedLanguageProvider>),
}
self_cell::self_cell! {
    struct Prepared {
        owner: Inputs,
        #[covariant]
        dependent: PreparedLanguageDefinition,
    }
}
pub(crate) struct Language {
    pub definition: LanguageDefinition,
    prepared: Prepared,
    pub metamodel: Arc<Metamodel>,
    pub bundle: DefinitionBundle,
    pub scopes: Vec<VerifiedScope>,
}
impl Language {
    pub fn new(definition: LanguageDefinition) -> Result<Self, String> {
        definition.validate()?;
        let structure = definition.structure.clone();
        let mut terminals = DefinitionSource::new(
            "org/eclipse/xtext/common/Terminals.xtext",
            SourceKind::Xtext,
            include_str!("../language/Terminals.xtext"),
        );
        terminals.dependencies.push(structure.id.clone());
        let mut grammar = definition.grammar.clone();
        for id in [structure.id.clone(), terminals.id.clone()] {
            if !grammar.dependencies.contains(&id) {
                grammar.dependencies.push(id);
            }
        }
        let mut stub = DefinitionSource::new(
            "intersect-view-host/load.rcore",
            SourceKind::RcoreBehavior,
            "rcore 1; package intersect.host.load version \"1\";",
        );
        stub.dependencies.push(structure.id.clone());
        let mut bindings = definition.bindings.clone();
        if !bindings.dependencies.contains(&structure.id) {
            bindings.dependencies.push(structure.id.clone());
        }
        let mut sources = vec![
            structure.clone(),
            terminals,
            grammar.clone(),
            stub.clone(),
            bindings,
        ];
        // Keep binding helper dependencies; root view activation belongs to M3.
        let mut needed = definition.bindings.dependencies.clone();
        let mut included = std::collections::BTreeSet::new();
        while let Some(id) = needed.pop() {
            if included.insert(id.clone())
                && let Some(source) = definition.view_functions.iter().find(|s| s.id == id)
            {
                needed.extend(source.dependencies.iter().cloned());
                sources.push(source.clone());
            }
        }
        let input = BundleCompilation {
            bundle: DefinitionBundle {
                version: 1,
                sources,
                namespaces: vec![],
            },
            ecore: structure.id.clone(),
            xtext: Some(grammar.id),
            rcore_behavior: stub.id,
            namespace: definition.namespace.clone(),
            materialized_types: vec![],
        };
        let targets = if structure.kind == SourceKind::Ecore {
            [(structure.id.clone(), format!("{}.rcore", structure.id.uri))].into()
        } else {
            Default::default()
        };
        let migration =
            intersect_model::migration::migrate_ecore_bundle(input.bundle.clone(), &targets)
                .map_err(|e| format!("Migrate language: {e}"))?;
        let compilation = intersect_text::migration::remap_compilation(&migration, &input)?;
        let prepared = Prepared::try_new(
            Inputs::Authored(Box::new(AuthoredInputs {
                compilation,
                migration,
            })),
            |inputs| {
                let Inputs::Authored(inputs) = inputs else {
                    return Err("Expected authored language inputs".into());
                };
                let policy = CompilationSourcePolicy::default();
                intersect_text::compiler::prepare_bundle_with_borrowed_authored_validation(
                    &inputs.compilation,
                    &inputs.migration,
                    Profile::NativeV80,
                    &[],
                    None,
                    policy,
                    policy,
                    &|_, _, _| Ok(()),
                )
                .map_err(|e| format!("Prepare language: {e:?}"))
            },
        )?;
        let view = prepared.borrow_dependent();
        let metamodel = Arc::new(Metamodel::freeze(view.schema()).map_err(|e| e.to_string())?);
        let bundle = view.sources().clone();
        let bindings = bundle
            .sources
            .iter()
            .find(|s| s.id.uri == definition.bindings.id.uri)
            .ok_or("Missing remapped bindings")?;
        let scopes = compile_scopes(&bundle, bindings)?;
        Ok(Self {
            definition,
            prepared,
            metamodel,
            bundle,
            scopes,
        })
    }
    pub fn from_prepared(
        definition: LanguageDefinition,
        provider: Box<dyn PreparedLanguageProvider>,
        metamodel: Arc<Metamodel>,
    ) -> Result<Self, String> {
        definition.validate()?;
        let prepared = Prepared::try_new(Inputs::External(provider), |inputs| {
            let Inputs::External(provider) = inputs else {
                return Err("Expected a prepared language owner".into());
            };
            provider.prepare()
        })?;
        let view = prepared.borrow_dependent();
        // A language may apply its checked metamodel redefinitions when freezing.
        // It must still use the exact schema revision retained by this owner.
        if metamodel.revision() != view.schema().revision {
            return Err("Prepared language and frozen metamodel revisions differ".into());
        }
        let bundle = view.sources().clone();
        Ok(Self {
            definition,
            prepared,
            metamodel,
            bundle,
            scopes: vec![],
        })
    }
    pub fn prepared(&self) -> &PreparedLanguageDefinition<'_> {
        self.prepared.borrow_dependent()
    }
    pub fn is_model_source(&self, uri: &str) -> bool {
        let path = uri.split(['?', '#']).next().map_or(uri, |s| s);
        self.definition
            .file_extensions
            .iter()
            .any(|ext| path.ends_with(&format!(".{}", ext.trim_start_matches('.'))))
    }
}

pub(crate) fn compile_scopes(
    bundle: &DefinitionBundle,
    bindings: &DefinitionSource,
) -> Result<Vec<VerifiedScope>, String> {
    let limits = ParseLimits {
        source_bytes: 1_000_000,
    };
    let mut declarations: Vec<_> = source_scope_bindings(bindings, limits)
        .map_err(|e| format!("Read scope bindings: {e:?}"))?
        .into_iter()
        .map(|b| (b.declaration, BindingKind::Scope))
        .collect();
    declarations.extend(
        source_validate_bindings(bindings, limits)
            .map_err(|e| format!("Read validation bindings: {e:?}"))?
            .into_iter()
            .map(|b| (b.declaration, BindingKind::Validate)),
    );
    declarations.extend(
        source_default_bindings(bindings, limits)
            .map_err(|e| format!("Read default bindings: {e:?}"))?
            .into_iter()
            .map(|b| (b.declaration, BindingKind::Default)),
    );
    declarations.extend(
        source_implicit_bindings(bindings, limits)
            .map_err(|e| format!("Read implicit bindings: {e:?}"))?
            .into_iter()
            .map(|b| (b.declaration, BindingKind::Implicit)),
    );
    compile_binding_kinds_with_source_limits(
        bundle,
        &bindings.id,
        &declarations,
        &Limits::default(),
        limits,
    )
    .map_err(|e| format!("Compile language bindings: {e:?}"))
}
