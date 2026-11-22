//! Borrowed access to a checked project and its read-only dependencies.
use intersect_model::{
    components::MountedReadModel,
    frozen::{ClassId, FeatureId, FrozenStore, Metamodel, Model, Obj, ObjId},
    storage::{ModelRead, ObjectView},
};
use std::rc::Rc;

pub(crate) enum AcceptedModel {
    Frozen {
        model: Box<Model>,
        store: Box<FrozenStore>,
    },
    Mounted(Rc<MountedReadModel>),
}

impl AcceptedModel {
    pub(crate) fn project(&self) -> ProjectModel<'_> {
        match self {
            Self::Frozen { model, .. } => ProjectModel::Frozen(model),
            Self::Mounted(model) => ProjectModel::Mounted(model),
        }
    }

    pub(crate) fn reader(&self) -> &dyn ModelRead {
        match self {
            Self::Frozen { store, .. } => store.as_ref(),
            Self::Mounted(model) => model.model(),
        }
    }
}

/// A revision-local view of the checked model accepted by the host.
#[derive(Clone, Copy)]
pub enum ProjectModel<'a> {
    Frozen(&'a Model),
    Mounted(&'a MountedReadModel),
}

impl<'a> From<&'a Model> for ProjectModel<'a> {
    fn from(model: &'a Model) -> Self {
        Self::Frozen(model)
    }
}

impl<'a> ProjectModel<'a> {
    pub fn frozen(self) -> Option<&'a Model> {
        match self {
            Self::Frozen(model) => Some(model),
            Self::Mounted(_) => None,
        }
    }

    pub fn metamodel(self) -> &'a Metamodel {
        match self {
            Self::Frozen(model) => model.metamodel(),
            Self::Mounted(model) => model.metamodel(),
        }
    }

    pub fn objects(self) -> Box<dyn Iterator<Item = ProjectObject<'a>> + 'a> {
        match self {
            Self::Frozen(model) => Box::new(model.objects().map(ProjectObject::from)),
            Self::Mounted(model) => {
                Box::new(model.identities().filter_map(move |id| self.lookup(id)))
            }
        }
    }

    pub fn lookup(self, identity: &str) -> Option<ProjectObject<'a>> {
        match self {
            Self::Frozen(model) => model.lookup(identity).map(ProjectObject::from),
            Self::Mounted(model) => self.obj(model.lookup(identity)?),
        }
    }

    pub fn obj(self, id: ObjId) -> Option<ProjectObject<'a>> {
        match self {
            Self::Frozen(model) => model.obj(id).map(ProjectObject::from),
            Self::Mounted(model) => {
                let data = model.object(id).ok()??;
                let class = model.metamodel().class(data.class())?;
                Some(ProjectObject(Object::Mounted {
                    model,
                    id,
                    class,
                    data,
                }))
            }
        }
    }
}

#[derive(Clone, Copy)]
enum Object<'a> {
    Frozen(Obj<'a>),
    Mounted {
        model: &'a MountedReadModel,
        id: ObjId,
        class: ClassId,
        data: ObjectView<'a>,
    },
}

/// An element borrowed from a specific accepted project revision.
#[derive(Clone, Copy)]
pub struct ProjectObject<'a>(Object<'a>);

impl<'a> From<Obj<'a>> for ProjectObject<'a> {
    fn from(object: Obj<'a>) -> Self {
        Self(Object::Frozen(object))
    }
}

impl<'a> ProjectObject<'a> {
    pub(crate) fn mounted_view(self) -> Option<ObjectView<'a>> {
        match self.0 {
            Object::Frozen(_) => None,
            Object::Mounted { data, .. } => Some(data),
        }
    }

    pub fn id(self) -> ObjId {
        match self.0 {
            Object::Frozen(object) => object.id(),
            Object::Mounted { id, .. } => id,
        }
    }

    pub fn identity(self) -> &'a str {
        match self.0 {
            Object::Frozen(object) => object.identity(),
            Object::Mounted { data, .. } => data.id(),
        }
    }

    pub fn class(self) -> ClassId {
        match self.0 {
            Object::Frozen(object) => object.class(),
            Object::Mounted { class, .. } => class,
        }
    }

    pub fn class_key(self) -> &'a str {
        match self.0 {
            Object::Frozen(object) => object.class_key(),
            Object::Mounted { data, .. } => data.class(),
        }
    }

    pub fn resource(self) -> &'a str {
        match self.0 {
            Object::Frozen(object) => object.resource(),
            Object::Mounted { data, .. } => data.resource(),
        }
    }

    pub fn span(self) -> (usize, usize) {
        match self.0 {
            Object::Frozen(object) => object.span(),
            Object::Mounted { data, .. } => (data.start(), data.end()),
        }
    }

    pub fn container(self) -> Option<Self> {
        match self.0 {
            Object::Frozen(object) => object.container().map(|(parent, _)| parent.into()),
            Object::Mounted { model, id, .. } => {
                ProjectModel::Mounted(model).obj(model.container(id)?)
            }
        }
    }

    pub fn feature(self, name: &str) -> Option<FeatureId> {
        match self.0 {
            Object::Frozen(object) => object.feature(name),
            Object::Mounted { model, class, .. } => model.metamodel().feature(class, name),
        }
    }

    pub fn str(self, feature: FeatureId) -> Option<&'a str> {
        match self.0 {
            Object::Frozen(object) => object.str(feature),
            Object::Mounted { model, data, .. } => data
                .value(model.metamodel().feature_name(feature))?
                .as_str(),
        }
    }
}
