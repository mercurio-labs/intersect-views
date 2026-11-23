//! M12 presentation admission uses only supplied bytes and the existing cache.
use crate::{Host, runtime::Runtime};
use intersect_views::{
    GraphicDefinitions, GraphicInstance, GraphicRole, GraphicRule, GraphicValue, ParameterRule,
    ParameterType, PresentationContext, PresentationInput, PresentationResourceKind, RuleSet,
    SymbolLibrary,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub(crate) struct PreparedPresentation {
    pub context: PresentationContext,
    pub registry: Option<intersect_views::RenderingRegistry>,
    pub palette: Option<intersect_views::Palette>,
    pub notation: Option<intersect_views::NotationProfile>,
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
impl Host {
    pub(crate) fn language_fingerprint(&self) -> Result<String, String> {
        // The source bundle is already prepared/checked, and includes imported
        // definition identities rather than just the language's display name.
        let sources = serde_json::to_value(&self.language.bundle).map_err(|e| e.to_string())?;
        Ok(hash(&intersect_views::canonical_presentation_bytes(
            &sources,
        )?))
    }
    pub(crate) fn presentation_context(&self) -> PresentationContext {
        self.presentation
            .as_ref()
            .map(|p| p.context.clone())
            .unwrap_or_default()
    }
    pub(crate) fn prepare_presentation(&mut self, params: &Value) -> Result<Value, String> {
        if !self.initialized
            || self.current.is_some()
            || !self.sources.is_empty()
            || self.pending.is_some()
            || self.presentation.is_some()
        {
            return Err("Presentation preparation requires an initialized new host; replace the host/session to change packages".into());
        }
        let input: PresentationInput = serde_json::from_value(params.clone())
            .map_err(|e| format!("Invalid presentation input: {e}"))?;
        let language_fingerprint = self.language_fingerprint()?;
        let resolved = input.resolve(
            &self.language.definition.namespace,
            &language_fingerprint,
            &hash,
        )?;
        let mut libraries = Vec::new();
        let mut rules = Vec::new();
        let mut palette = None;
        let mut notation = None;
        let mut registry = None;
        for (reference, resource) in resolved.resources {
            match reference.kind {
                PresentationResourceKind::SymbolLibrary => {
                    let library = serde_json::from_str::<SymbolLibrary>(&resource.content)
                        .map_err(|e| format!("{}: {e}", reference.id))?;
                    for manifest in &resolved.manifests {
                        if manifest.resources.iter().any(|r| r.id == reference.id) {
                            intersect_views::require_property_capability(
                                &library,
                                &manifest.requires,
                            )?;
                        }
                    }
                    libraries.push(library);
                }
                PresentationResourceKind::RuleSet => {
                    let rule: RuleSet = serde_json::from_str(&resource.content)
                        .map_err(|e| format!("{}: {e}", reference.id))?;
                    rule.validate()?;
                    if !matches!(rule, RuleSet::Graph(_)) {
                        return Err(
                            "This presentation capability supports graph rule resources only"
                                .into(),
                        );
                    }
                    if rules.iter().any(|r: &RuleSet| r.id() == rule.id()) {
                        return Err("Duplicate presentation rule set".into());
                    }
                    rules.push(rule);
                }
                PresentationResourceKind::Palette => {
                    if palette.is_some() {
                        return Err("More than one palette in the presentation closure".into());
                    }
                    let value: intersect_views::Palette =
                        serde_json::from_str(&resource.content).map_err(|e| e.to_string())?;
                    value.validate()?;
                    palette = Some(value);
                }
                PresentationResourceKind::RenderingRegistry => {
                    if registry.is_some() {
                        return Err(
                            "More than one rendering registry in presentation closure".into()
                        );
                    }
                    registry = Some(
                        serde_json::from_str::<intersect_views::RenderingRegistry>(
                            &resource.content,
                        )
                        .map_err(|e| e.to_string())?,
                    );
                }
                PresentationResourceKind::Notation => {
                    if notation.is_some() {
                        return Err(
                            "More than one notation profile in the presentation closure".into()
                        );
                    }
                    let value: intersect_views::NotationProfile =
                        serde_json::from_str(&resource.content).map_err(|e| e.to_string())?;
                    value.validate()?;
                    notation = Some(value);
                }
            }
        }
        if let Some(registry) = &registry {
            registry.validate(
                &rules
                    .iter()
                    .map(|r| r.graph().cloned())
                    .collect::<Result<Vec<_>, _>>()?,
            )?;
        }
        let definitions = GraphicDefinitions::new(&libraries)?;
        for rule in &rules {
            let graph = rule.graph()?;
            for symbol in &graph.symbols {
                if let Some(rule) = &symbol.graphic {
                    validate_graphic_rule(
                        &definitions,
                        rule,
                        if symbol.emit == "port" {
                            GraphicRole::Port
                        } else {
                            GraphicRole::Node
                        },
                    )?;
                }
            }
            for edge in &graph.edges {
                for marker in edge.markers().into_iter().flatten() {
                    validate_graphic_rule(&definitions, marker, GraphicRole::Marker)?;
                }
            }
        }
        let context = PresentationContext {
            fingerprint: resolved.fingerprint,
            libraries,
        };
        let response = json!({"presentation":context,"ruleSets":rules.iter().map(|r|r.id()).collect::<Vec<_>>()});
        // This is the only mutable step. Runtime validates signatures against
        // its checked cache and rolls its rule list back on rejection.
        self.language.install_presentation_rules(rules)?;
        self.presentation = Some(PreparedPresentation {
            context,
            registry,
            palette,
            notation,
        });
        Ok(response)
    }
    pub(crate) fn finalize_graphics(
        &self,
        scene: &mut intersect_views::GraphScene,
    ) -> Result<(), String> {
        let context = self.presentation_context();
        let definitions = GraphicDefinitions::new(&context.libraries)?;
        fn complete(
            instance: &mut Option<GraphicInstance>,
            definitions: &GraphicDefinitions<'_>,
        ) -> Result<(), String> {
            if let Some(instance) = instance {
                let d = definitions.definition(&instance.definition)?;
                if definitions
                    .definitions
                    .values()
                    .any(|d| !d.properties.is_empty())
                {
                    instance.source_parameters =
                        Some(instance.parameters.keys().cloned().collect());
                }
                for (name, parameter) in &d.parameters {
                    instance
                        .parameters
                        .entry(name.clone())
                        .or_insert_with(|| parameter.default_value());
                }
            }
            Ok(())
        }
        fn node(
            n: &mut intersect_views::Node,
            definitions: &GraphicDefinitions<'_>,
        ) -> Result<(), String> {
            complete(&mut n.graphic, definitions)?;
            for port in &mut n.ports {
                complete(&mut port.graphic, definitions)?;
            }
            for child in &mut n.children {
                node(child, definitions)?;
            }
            if let Some(regions) = &mut n.regions {
                for region in &mut regions.items {
                    for child in &mut region.children {
                        node(child, definitions)?;
                    }
                }
            }
            Ok(())
        }
        for n in &mut scene.nodes {
            node(n, &definitions)?;
        }
        for edge in &mut scene.edges {
            complete(&mut edge.start_marker, &definitions)?;
            complete(&mut edge.end_marker, &definitions)?;
        }
        Ok(())
    }
}
fn validate_graphic_rule(
    definitions: &GraphicDefinitions<'_>,
    rule: &GraphicRule,
    role: GraphicRole,
) -> Result<(), String> {
    let d = definitions.definition(&rule.definition)?;
    let mut parameters: BTreeMap<String, GraphicValue> = d
        .parameters
        .iter()
        .map(|(k, p)| (k.clone(), p.default_value()))
        .collect();
    for (name, value) in &rule.parameters {
        let p = d
            .parameters
            .get(name)
            .ok_or_else(|| format!("Unknown graphical rule parameter {name}"))?;
        match value {
            ParameterRule::Constant { value } => {
                if !p.accepts(value) {
                    return Err("Invalid graphical constant for declared parameter".into());
                }
                parameters.insert(name.clone(), value.clone());
            }
            ParameterRule::String { .. }
                if matches!(
                    p,
                    ParameterType::String { .. } | ParameterType::Choice { .. }
                ) => {}
            ParameterRule::Bool { .. } if matches!(p, ParameterType::Bool { .. }) => {}
            _ => return Err("Incompatible graphical function/parameter type".into()),
        }
    }
    definitions.instance(
        &GraphicInstance {
            definition: rule.definition.clone(),
            source_parameters: None,
            parameters,
            slots: rule.slots.clone(),
        },
        role,
    )
}
impl Runtime {
    pub(crate) fn install_presentation_rules(&mut self, rules: Vec<RuleSet>) -> Result<(), String> {
        self.with_dependent_mut(|language, functions| {
            if rules.iter().any(|r| {
                functions
                    .rules
                    .iter()
                    .any(|existing| r.id() == existing.id())
            }) {
                return Err("Presentation rule set collides with a registered rule".into());
            }
            let before = functions.rules.len();
            functions.rules.extend(rules);
            if let Err(error) = functions.validate(language) {
                functions.rules.truncate(before);
                return Err(error);
            }
            Ok(())
        })
    }
}
