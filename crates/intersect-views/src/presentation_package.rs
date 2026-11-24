//! Portable presentation resource input. Resolution is over supplied bytes only.
use crate::{GRAPHICS_VERSION, SymbolLibrary, graphic_id};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresentationInput {
    pub root: String,
    pub manifests: Vec<PresentationManifest>,
    pub resources: Vec<PresentationResource>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresentationManifest {
    pub schema_version: u32,
    pub id: String,
    pub version: String,
    pub language: String,
    pub language_fingerprint: String,
    pub requires: Vec<String>,
    pub dependencies: Vec<PresentationDependency>,
    pub resources: Vec<PresentationResourceRef>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationDependency {
    pub id: String,
    pub version: String,
    pub sha256: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationResource {
    pub id: String,
    pub content: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PresentationResourceRef {
    pub id: String,
    pub kind: PresentationResourceKind,
    pub sha256: String,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PresentationResourceKind {
    SymbolLibrary,
    RuleSet,
    Palette,
    Notation,
    RenderingRegistry,
}

/// Hashing is injected so contracts remain independent of a crypto implementation.
/// The host and client use SHA-256 over precisely these bytes.
pub fn presentation_digest(
    bytes: &[u8],
    hash: &impl Fn(&[u8]) -> String,
) -> Result<String, String> {
    let digest = hash(bytes);
    if digest.len() != 64
        || !digest
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("Expected a lowercase SHA-256 digest".into());
    }
    Ok(digest)
}
pub const PRESENTATION_CAPABILITIES: &[&str] = &[
    "graphics.composition.v1",
    "graphics.text.v1",
    "graphics.anchors.v1",
    "rules.graph.v6",
    "rules.graph.v7",
    "views.rendering.v1",
    "rules.graph.v8",
    "views.routing.v1",
    "views.labelPlacement.v1",
    "views.symbolProperties.v1",
];
pub struct ResolvedPresentation<'a> {
    pub manifests: Vec<&'a PresentationManifest>,
    pub resources: Vec<(&'a PresentationResourceRef, &'a PresentationResource)>,
    pub fingerprint: String,
}
pub fn canonical_presentation_bytes(value: &serde_json::Value) -> Result<Vec<u8>, String> {
    fn sorted(value: &serde_json::Value) -> serde_json::Value {
        match value {
            serde_json::Value::Object(map) => {
                let ordered: BTreeMap<_, _> =
                    map.iter().map(|(k, v)| (k.clone(), sorted(v))).collect();
                serde_json::Value::Object(ordered.into_iter().collect())
            }
            serde_json::Value::Array(values) => {
                serde_json::Value::Array(values.iter().map(sorted).collect())
            }
            other => other.clone(),
        }
    }
    serde_json::to_vec(&sorted(value)).map_err(|e| e.to_string())
}
impl PresentationManifest {
    pub fn key(&self) -> String {
        format!("{}@{}", self.id, self.version)
    }
    pub fn canonical_bytes(&self) -> Result<Vec<u8>, String> {
        // Canonical key order is defined recursively, independent of struct order.
        let value = serde_json::to_value(self).map_err(|e| e.to_string())?;
        canonical_presentation_bytes(&value)
    }
}
impl PresentationInput {
    pub fn resolve<'a>(
        &'a self,
        language: &str,
        fingerprint: &str,
        hash: &impl Fn(&[u8]) -> String,
    ) -> Result<ResolvedPresentation<'a>, String> {
        graphic_id(&self.root)?;
        if fingerprint.len() != 64
            || !fingerprint
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err("Invalid prepared language fingerprint".into());
        }
        if self.manifests.is_empty() || self.manifests.len() > 64 || self.resources.len() > 64 {
            return Err("Presentation manifest/resource limit".into());
        }
        let bytes = serde_json::to_vec(self).map_err(|e| e.to_string())?;
        if bytes.len() > 2 * 1024 * 1024 {
            return Err("Presentation input exceeds 2 MiB".into());
        }
        let mut manifests = BTreeMap::new();
        let mut resources = BTreeMap::new();
        for manifest in &self.manifests {
            for name in [&manifest.id, &manifest.version, &manifest.language] {
                graphic_id(name)?;
            }
            if manifest.id.contains('@')
                || manifest.version.contains('@')
                || manifest
                    .dependencies
                    .iter()
                    .any(|d| d.id.contains('@') || d.version.contains('@'))
            {
                return Err("Ambiguous package identity separator".into());
            }
            if manifest.schema_version != GRAPHICS_VERSION
                || manifest.language != language
                || manifest.language_fingerprint != fingerprint
            {
                return Err("Presentation language/version/fingerprint mismatch".into());
            }
            if manifest.requires.len() > 64
                || manifest.dependencies.len() > 64
                || manifest.resources.len() > 64
            {
                return Err("Presentation manifest member limit".into());
            }
            if manifest
                .resources
                .iter()
                .any(|r| matches!(r.kind, PresentationResourceKind::RenderingRegistry))
                && !manifest.requires.iter().any(|c| c == "views.rendering.v1")
            {
                return Err("Rendering registry requires views.rendering.v1".into());
            }
            let mut capabilities = BTreeSet::new();
            for required in &manifest.requires {
                if !PRESENTATION_CAPABILITIES.contains(&required.as_str())
                    || !capabilities.insert(required)
                {
                    return Err(format!(
                        "Unsupported/duplicate presentation capability {required}"
                    ));
                }
            }
            if manifest
                .resources
                .iter()
                .any(|r| matches!(r.kind, PresentationResourceKind::RuleSet))
                && [
                    "rules.graph.v8",
                    "views.routing.v1",
                    "views.labelPlacement.v1",
                ]
                .iter()
                .any(|required| !manifest.requires.iter().any(|c| c == required))
            {
                return Err("M14 graph rule resources require rules.graph.v8, views.routing.v1 and views.labelPlacement.v1".into());
            }
            if manifests.insert(manifest.key(), manifest).is_some() {
                return Err("Duplicate presentation manifest".into());
            }
        }
        for resource in &self.resources {
            graphic_id(&resource.id)?;
            if resources.insert(&resource.id, resource).is_some() {
                return Err("Duplicate presentation resource".into());
            }
        }
        let mut result = ResolvedPresentation {
            manifests: vec![],
            resources: vec![],
            fingerprint: String::new(),
        };
        let mut visiting = BTreeSet::new();
        let mut seen = BTreeSet::new();
        let mut resource_seen = BTreeMap::new();
        struct Walker<'a, 'h, H: Fn(&[u8]) -> String> {
            manifests: &'h BTreeMap<String, &'a PresentationManifest>,
            resources: &'h BTreeMap<&'a String, &'a PresentationResource>,
            hash: &'h H,
        }
        impl<'a, H: Fn(&[u8]) -> String> Walker<'a, '_, H> {
            fn visit(
                &self,
                key: &str,
                visiting: &mut BTreeSet<String>,
                seen: &mut BTreeSet<String>,
                resource_seen: &mut BTreeMap<String, String>,
                result: &mut ResolvedPresentation<'a>,
            ) -> Result<(), String> {
                if visiting.contains(key) {
                    return Err("Presentation dependency cycle".into());
                }
                if seen.contains(key) {
                    return Ok(());
                }
                let manifest = *self
                    .manifests
                    .get(key)
                    .ok_or_else(|| format!("Missing presentation manifest {key}"))?;
                visiting.insert(key.into());
                let mut dependencies = BTreeSet::new();
                for dependency in &manifest.dependencies {
                    let key = format!("{}@{}", dependency.id, dependency.version);
                    if !dependencies.insert(key.clone()) {
                        return Err("Duplicate presentation dependency".into());
                    }
                    let target = self
                        .manifests
                        .get(&key)
                        .ok_or("Missing presentation dependency")?;
                    if presentation_digest(&target.canonical_bytes()?, self.hash)?
                        != dependency.sha256
                    {
                        return Err("Presentation dependency hash mismatch".into());
                    }
                    self.visit(&key, visiting, seen, resource_seen, result)?;
                }
                let mut local_resources = BTreeSet::new();
                for reference in &manifest.resources {
                    if !local_resources.insert(&reference.id) {
                        return Err("Duplicate resource reference".into());
                    }
                    let resource = *self
                        .resources
                        .get(&reference.id)
                        .ok_or_else(|| format!("Missing presentation resource {}", reference.id))?;
                    let digest = presentation_digest(resource.content.as_bytes(), self.hash)?;
                    if digest != reference.sha256 {
                        return Err(format!(
                            "Presentation resource hash mismatch: {}",
                            reference.id
                        ));
                    }
                    let signature = format!("{:?}:{}", reference.kind, digest);
                    if let Some(previous) = resource_seen.get(&reference.id) {
                        if *previous != signature {
                            return Err("Conflicting shared resource kind/hash".into());
                        }
                    } else {
                        resource_seen.insert(reference.id.clone(), signature);
                        result.resources.push((reference, resource));
                    }
                }
                visiting.remove(key);
                seen.insert(key.into());
                result.manifests.push(manifest);
                Ok(())
            }
        }
        Walker {
            manifests: &manifests,
            resources: &resources,
            hash,
        }
        .visit(
            &self.root,
            &mut visiting,
            &mut seen,
            &mut resource_seen,
            &mut result,
        )?;
        if seen.len() != self.manifests.len() || resource_seen.len() != self.resources.len() {
            return Err("Unreferenced presentation input is not admitted".into());
        }
        let identity = serde_json::json!({"language":fingerprint,"manifests":result.manifests,"resources":result.resources.iter().map(|(r,_)|*r).collect::<Vec<_>>()});
        result.fingerprint = presentation_digest(&canonical_presentation_bytes(&identity)?, hash)?;
        Ok(result)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresentationContext {
    pub fingerprint: String,
    pub libraries: Vec<SymbolLibrary>,
}
impl Default for PresentationContext {
    fn default() -> Self {
        Self {
            fingerprint: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855".into(),
            libraries: vec![],
        }
    }
}
impl PresentationContext {
    pub fn validate_scene(&self, scene: &crate::Scene) -> Result<(), String> {
        if self.fingerprint.len() != 64
            || !self
                .fingerprint
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err("Invalid presentation fingerprint".into());
        }
        let definitions = crate::GraphicDefinitions::new(&self.libraries)?;
        struct Audit<'a, 'b> {
            definitions: &'a crate::GraphicDefinitions<'b>,
            cost: crate::GraphicCost,
        }
        impl Audit<'_, '_> {
            fn instance(
                &mut self,
                instance: Option<&crate::GraphicInstance>,
                text: &BTreeMap<String, crate::TextBlock>,
                role: crate::GraphicRole,
            ) -> Result<(), String> {
                if let Some(instance) = instance {
                    self.definitions
                        .instance(instance, role)
                        .map_err(|e| format!("Graphic {}: {e}", instance.definition))?;
                    self.cost.add(&self.definitions.cost(
                        &instance.definition,
                        &mut Vec::new(),
                        0,
                    )?)?;
                    for source in instance.slots.values() {
                        if let crate::ContentSource::Text { name } = source
                            && !text.contains_key(name)
                        {
                            return Err("Graphic instance maps a missing TextBlock".into());
                        }
                    }
                }
                Ok(())
            }
            fn node(&mut self, node: &crate::Node) -> Result<(), String> {
                self.instance(node.graphic.as_ref(), &node.text, crate::GraphicRole::Node)?;
                if let Some(graphic) = &node.graphic
                    && ((!node.children.is_empty()
                        && !graphic
                            .slots
                            .values()
                            .any(|s| matches!(s, crate::ContentSource::Children)))
                        || (node.regions.as_ref().is_some_and(|r| !r.items.is_empty())
                            && !graphic
                                .slots
                                .values()
                                .any(|s| matches!(s, crate::ContentSource::Regions))))
                {
                    return Err(
                        "Graphical container must expose its visible child/region content".into(),
                    );
                }
                for port in &node.ports {
                    self.instance(port.graphic.as_ref(), &port.text, crate::GraphicRole::Port)?;
                }
                for child in &node.children {
                    self.node(child)?;
                }
                if let Some(regions) = &node.regions {
                    for region in &regions.items {
                        for child in &region.children {
                            self.node(child)?;
                        }
                    }
                }
                Ok(())
            }
        }
        let mut audit = Audit {
            definitions: &definitions,
            cost: Default::default(),
        };
        if let crate::Scene::Graph(scene) = scene {
            for node in &scene.nodes {
                audit.node(node)?;
            }
            for edge in &scene.edges {
                for instance in [&edge.start_marker, &edge.end_marker].into_iter().flatten() {
                    audit.instance(Some(instance), &edge.text, crate::GraphicRole::Marker)?;
                }
            }
        }
        Ok(())
    }
}
