//! Ported named class/name paths and anonymous bindings. No name search/scoping.
use crate::{ProjectModel, ProjectObject};
use intersect_views::Binding;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
pub(crate) fn name<'a>(object: ProjectObject<'a>, features: &[String]) -> Option<&'a str> {
    features.iter().find_map(|f| {
        object
            .feature(f)
            .and_then(|f| object.str(f))
            .filter(|s| !s.is_empty())
    })
}
fn parent<'a>(mut object: ProjectObject<'a>, features: &[String]) -> Option<ProjectObject<'a>> {
    while let Some(owner) = object.container() {
        if name(owner, features).is_some() {
            return Some(owner);
        }
        object = owner;
    }
    None
}
fn path(object: ProjectObject<'_>, features: &[String]) -> Result<Vec<(String, String)>, String> {
    let mut result = vec![];
    let mut current = Some(object);
    let mut seen = BTreeSet::new();
    while let Some(object) = current {
        if !seen.insert(object.identity()) || seen.len() > 64 {
            return Err("Cyclic or deep semantic identity path".into());
        }
        if let Some(name) = name(object, features) {
            result.push((object.class_key().to_owned(), name.to_owned()));
        }
        current = parent(object, features);
    }
    result.reverse();
    Ok(result)
}
fn hash(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
// A completed language model can introduce named zero-width declarations below
// anonymous semantic owners. They are not the authored declaration with the same
// qualified name. Use actual ownership roles, never snapshot IDs or byte offsets.
fn inferred_owners(object: ProjectObject<'_>, features: &[String]) -> Result<Vec<String>, String> {
    let mut result = Vec::new();
    let mut current = object.container();
    let mut seen = BTreeSet::new();
    while let Some(owner) = current {
        if !seen.insert(owner.identity()) || seen.len() > 64 {
            return Err("Cyclic or deep inferred identity path".into());
        }
        if name(owner, features).is_some() {
            break;
        }
        result.push(owner.class_key().to_owned());
        current = owner.container();
    }
    result.reverse();
    Ok(result)
}
pub fn key<'a>(
    object: impl Into<ProjectObject<'a>>,
    features: &[String],
    context: &[String],
) -> Result<String, String> {
    let object = object.into();
    if name(object, features).is_some() {
        let path = path(object, features)?;
        let identity = if object.span().0 == object.span().1 {
            serde_json::to_string(&(
                object.resource(),
                path,
                "inferred",
                inferred_owners(object, features)?,
            ))
        } else {
            // Retain the established persistent key of authored declarations.
            serde_json::to_string(&(object.resource(), path))
        }
        .map_err(|e| e.to_string())?;
        Ok(format!("element:{}", hash(&identity)))
    } else {
        Ok(format!(
            "anonymous:{}",
            hash(&format!(
                "{}:{}:{}:{context:?}",
                object.resource(),
                object.class_key(),
                object.span().0
            ))
        ))
    }
}

pub(crate) fn catalog(
    model: ProjectModel<'_>,
    features: &[String],
    editable: &BTreeSet<String>,
) -> Result<BTreeMap<String, String>, String> {
    let mut result = BTreeMap::new();
    for object in model
        .objects()
        .filter(|o| name(*o, features).is_some() && editable.contains(o.resource()))
    {
        if result
            .insert(key(object, features, &[])?, object.identity().to_owned())
            .is_some()
        {
            return Err(
                "Ambiguous declaration paths cannot be bound to persistent diagrams".into(),
            );
        }
    }
    Ok(result)
}
pub(crate) fn binding(
    object: ProjectObject<'_>,
    features: &[String],
    text: &str,
    editable: &BTreeSet<String>,
    context: &[String],
) -> Result<Binding, String> {
    let (start, end) = object.span();
    Ok(Binding {
        key: key(object, features, context)?,
        element_id: object.identity().into(),
        context: context.to_vec(),
        uri: object.resource().into(),
        range: crate::positions::range(text, start, end),
        read_only: !editable.contains(object.resource()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use intersect_model::core::frozen::{ById, Metamodel, Model, ModelBuilder};
    use std::sync::Arc;

    fn fixture(offset: usize, inferred: bool) -> Result<Model, String> {
        let package = intersect_model::compile_rcore_at(
            "memory:/identity.rcore",
            r#"rcore 1; package identity version "1";
            metamodel "urn:identity" prefix i {
              class Node { attr name: String [1,1]; ref children: Node [0,*] containment; }
            }"#,
        )
        .map_err(|e| e.to_string())?;
        let schema = package.schema();
        let class_key = schema
            .declarations
            .iter()
            .find(|(key, d)| d.name == "Node" && schema.classes.contains_key(*key))
            .map(|(key, _)| key)
            .ok_or("No fixture class")?;
        let mm = Arc::new(Metamodel::freeze(schema).map_err(|e| e.to_string())?);
        let class = mm.class(class_key).ok_or("No frozen fixture class")?;
        let name = mm.feature(class, "name").ok_or("No name")?;
        let children = mm.feature(class, "children").ok_or("No children")?;
        let mut builder = ModelBuilder::new(mm);
        let uri = "file:///identity.model";
        let root = builder
            .create_at(&format!("root:{offset}"), class, uri, offset, offset + 40)
            .map_err(|e| e.to_string())?;
        let authored = builder
            .create_at(
                &format!("authored:{offset}"),
                class,
                uri,
                offset + 2,
                offset + 12,
            )
            .map_err(|e| e.to_string())?;
        let other = builder
            .create_at(
                &format!("other:{offset}"),
                class,
                uri,
                offset + 16,
                offset + if inferred { 16 } else { 25 },
            )
            .map_err(|e| e.to_string())?;
        for (object, value) in [(root, "Host"), (authored, "signal"), (other, "signal")] {
            builder
                .set_str(object, name, value)
                .map_err(|e| e.to_string())?;
        }
        for child in [authored, other] {
            builder
                .add_ref(root, children, child)
                .map_err(|e| e.to_string())?;
        }
        builder
            .link(&ById)
            .and_then(|linked| linked.validate())
            .map_err(|e| format!("{e:?}"))
    }

    #[test]
    fn inferred_and_authored_names_remain_distinct_across_source_offsets_and_snapshot_ids()
    -> Result<(), String> {
        let names = vec!["name".into()];
        let editable = BTreeSet::from(["file:///identity.model".into()]);
        let first = fixture(0, true)?;
        let moved = fixture(100, true)?;
        let a = catalog(ProjectModel::Frozen(&first), &names, &editable)?;
        let b = catalog(ProjectModel::Frozen(&moved), &names, &editable)?;
        assert_eq!(a.len(), 3);
        assert_eq!(a.keys().collect::<Vec<_>>(), b.keys().collect::<Vec<_>>());
        assert_ne!(
            a.values().collect::<Vec<_>>(),
            b.values().collect::<Vec<_>>()
        );
        Ok(())
    }

    #[test]
    fn genuinely_duplicate_authored_paths_still_refuse_publication() -> Result<(), String> {
        let model = fixture(0, false)?;
        let error = catalog(
            ProjectModel::Frozen(&model),
            &["name".into()],
            &BTreeSet::from(["file:///identity.model".into()]),
        )
        .err()
        .ok_or("Ambiguous authored names were accepted")?;
        assert!(error.contains("Ambiguous declaration paths"));
        Ok(())
    }
}
