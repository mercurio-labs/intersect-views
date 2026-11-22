//! Explicit language-owned prepared-definition and project-loading adapters.
use crate::{Host, ProjectModel, ProjectObject, Snapshot, identity, scenes::FunctionAdapter};
use crate::{
    Source,
    load::{FrozenLoad, LoadDiagnostic},
};
use intersect_model::core::query::QueryBudget;
use intersect_model::{components::MountedReadModel, frozen::Model};
use intersect_view_engine::{ElementId, ViewFunctions};
use intersect_views::{Binding, View, ViewDocument};
use serde_json::Value;
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

/// Extra read-only text and dependency metadata accompanying a language load.
/// `reference_sources` never participates in editor receipts or becomes writable.
pub struct LoadedSources {
    pub load: ProjectLoad,
    pub reference_sources: BTreeMap<String, String>,
    pub metadata: ProjectMetadata,
}

/// The language's checked model, along with the backing that owns its records.
pub enum LoadedModel {
    Frozen(Box<Model>),
    Mounted(Rc<MountedReadModel>),
}

impl LoadedModel {
    pub(crate) fn project(&self) -> ProjectModel<'_> {
        match self {
            Self::Frozen(model) => ProjectModel::Frozen(model),
            Self::Mounted(model) => ProjectModel::Mounted(model),
        }
    }
}

/// Results of analysis for the same source buffers used to prepare commands.
pub struct ProjectLoad {
    pub model: Option<LoadedModel>,
    pub diagnostics: Vec<LoadDiagnostic>,
    pub references: usize,
    pub resolved: usize,
    pub navigation: Vec<intersect_text::Reference>,
}

impl From<FrozenLoad> for ProjectLoad {
    fn from(load: FrozenLoad) -> Self {
        Self {
            model: load.model.map(|model| LoadedModel::Frozen(Box::new(model))),
            diagnostics: load.diagnostics,
            references: load.references,
            resolved: load.resolved,
            navigation: load.navigation,
        }
    }
}

impl ProjectLoad {
    pub(crate) fn is_clean(&self) -> bool {
        self.model.is_some()
            && !self.diagnostics.iter().any(LoadDiagnostic::is_error)
            && self.resolved == self.references
    }
}

#[derive(Default)]
pub struct ProjectMetadata {
    pub project: Option<Value>,
    pub dependency_uris: Vec<String>,
    pub dependencies: Vec<Value>,
    pub notes: Vec<String>,
}

/// A prepared language may own standard-library and archive loading. The host
/// invokes this same adapter for analysis and every isolated command candidate.
/// Only model-source buffers are passed; project documents stay in the host.
pub trait SourceLoader {
    fn load(&self, sources: &[Source]) -> Result<LoadedSources, String>;
}

/// A language-defined view retains its actual source binding and default scope.
pub enum ModelView {
    Resolved {
        document: ViewDocument,
        view: View,
        selection: Option<Box<intersect_views::RenderingSelection>>,
    },
    Unsupported {
        view: View,
        diagnostics: Vec<intersect_views::RenderingDiagnostic>,
    },
}
impl ModelView {
    pub fn view(&self) -> &View {
        match self {
            Self::Resolved { view, .. } | Self::Unsupported { view, .. } => view,
        }
    }
    pub fn document(&self) -> Result<&ViewDocument, String> {
        match self {
            Self::Resolved { document, .. } => Ok(document),
            Self::Unsupported { diagnostics, .. } => Err(diagnostics
                .iter()
                .map(|d| d.message.as_str())
                .collect::<Vec<_>>()
                .join("\n")),
        }
    }
}
pub trait ModelViews {
    fn views(&self, context: &ModelViewContext<'_>) -> Result<Vec<ModelView>, String>;
    /// Language admission for the effective scope, including caller exploration.
    fn validate_scope(
        &self,
        _context: &ModelViewContext<'_>,
        _view: &View,
        _scope: &intersect_views::Scope,
    ) -> Result<(), String> {
        Ok(())
    }
}

/// Bounded access to the accepted model and its cached unary Rcore entries.
/// No project mutation, source generator or transaction token is exposed.
pub struct ModelViewContext<'a> {
    pub(crate) host: &'a Host,
    pub(crate) snapshot: &'a Snapshot,
    pub(crate) budget: RefCell<QueryBudget>,
}
impl<'a> ModelViewContext<'a> {
    pub fn presentation_fingerprint(&self) -> String {
        self.host.presentation_context().fingerprint
    }
    pub fn rendering_registry(&self) -> Option<&intersect_views::RenderingRegistry> {
        self.host
            .presentation
            .as_ref()
            .and_then(|p| p.registry.as_ref())
    }
    pub fn model(&self) -> ProjectModel<'a> {
        self.snapshot.model()
    }
    pub fn element(&self, key: &str) -> Option<ProjectObject<'a>> {
        let element = self
            .snapshot
            .scene_keys(self.host)
            .ok()?
            .get(key)?
            .as_ref()?;
        self.snapshot
            .model()
            .obj(*self.snapshot.objects.get(&element.index())?)
    }

    pub fn editable(&self, object: ProjectObject<'_>) -> bool {
        self.host.editable.contains(object.resource())
    }
    pub fn key(&self, object: ProjectObject<'_>) -> Result<String, String> {
        identity::key(object, &self.host.language.definition.name_features, &[])
    }
    pub fn binding(&self, object: ProjectObject<'_>) -> Result<Binding, String> {
        identity::binding(
            object,
            &self.host.language.definition.name_features,
            self.host
                .source_text(object.resource())
                .ok_or("Missing model view source")?,
            &self.host.editable,
            &[],
        )
    }
    fn functions(&self) -> FunctionAdapter<'_> {
        FunctionAdapter {
            cache: self.host.language.cache(),
            snapshot: self.snapshot,
            budget: &self.budget,
        }
    }
    pub fn elements(
        &self,
        name: &str,
        owner: ProjectObject<'_>,
    ) -> Result<Vec<ProjectObject<'a>>, String> {
        self.check_owner(owner)?;
        self.functions()
            .elements(name, ElementId::new(owner.id().index()))
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|id| {
                self.snapshot
                    .objects
                    .get(&id.index())
                    .and_then(|object| self.snapshot.model().obj(*object))
                    .ok_or_else(|| "Catalog function returned a missing element".into())
            })
            .collect()
    }
    pub fn string(&self, name: &str, owner: ProjectObject<'_>) -> Result<String, String> {
        self.check_owner(owner)?;
        self.functions()
            .string(name, ElementId::new(owner.id().index()))
            .map_err(|e| e.to_string())
    }
    pub fn boolean(&self, name: &str, owner: ProjectObject<'_>) -> Result<bool, String> {
        self.check_owner(owner)?;
        self.functions()
            .boolean(name, ElementId::new(owner.id().index()))
            .map_err(|e| e.to_string())
    }
    fn check_owner(&self, owner: ProjectObject<'_>) -> Result<(), String> {
        if self
            .snapshot
            .model()
            .lookup(owner.identity())
            .is_none_or(|actual| actual.id() != owner.id())
        {
            return Err("Catalog receiver is outside the accepted model".into());
        }
        Ok(())
    }
}
