//! Data-only projection and model-view resolution contracts.
use crate::{Binding, GraphRuleSet, RuleSet, graphic_id};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

fn registration_id(id: &str) -> Result<(), String> {
    graphic_id(id)?;
    if !id.contains('.') || id.split('.').any(str::is_empty) {
        return Err("Unqualified rendering registration".into());
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ProjectionPolicy {
    Nested,
    ContainmentTree {
        #[serde(rename = "edgeRole")]
        edge_role: String,
        #[serde(rename = "edgeNotation")]
        edge_notation: String,
    },
}
impl ProjectionPolicy {
    pub fn validate(&self, graph: bool) -> Result<(), String> {
        if let Self::ContainmentTree {
            edge_role,
            edge_notation,
        } = self
        {
            if !graph {
                return Err("Containment tree requires graph rules".into());
            }
            graphic_id(edge_role)?;
            graphic_id(edge_notation)?;
        }
        Ok(())
    }
    pub fn kind(&self) -> &str {
        match self {
            Self::Nested => "nested",
            Self::ContainmentTree { .. } => "containmentTree",
        }
    }
}

/// Explicit migration; deserialization never silently upgrades an old envelope.
pub fn migrate_rules_v6(mut value: serde_json::Value) -> Result<RuleSet, String> {
    if value.get("schemaVersion").and_then(|v| v.as_u64()) != Some(6)
        || value.get("projection").is_some()
    {
        return Err("Expected an unmodified v6 rule envelope".into());
    }
    let object = value.as_object_mut().ok_or("Expected rule object")?;
    object.insert("schemaVersion".into(), 7.into());
    object.insert("projection".into(), serde_json::json!({"kind":"nested"}));
    Ok(preview_rules_v7(value)?.candidate)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RulesMigrationPreview {
    pub candidate: RuleSet,
    pub from: u32,
    pub to: u32,
    pub routing_added: bool,
    pub package_compatibility_review_required: bool,
}
/// Owned candidate only. No resource, fingerprint, file or installed package is changed.
pub fn preview_rules_v7(mut value: serde_json::Value) -> Result<RulesMigrationPreview, String> {
    if value.get("schemaVersion").and_then(|v| v.as_u64()) != Some(7)
        || value.get("routing").is_some()
    {
        return Err("Expected an unmodified v7 rule envelope".into());
    }
    let routing_added = value.get("form").and_then(|v| v.as_str()) == Some("graph");
    let object = value.as_object_mut().ok_or("Expected rule object")?;
    object.insert("schemaVersion".into(), crate::RULE_VERSION.into());
    if routing_added {
        object.insert(
            "routing".into(),
            serde_json::to_value(crate::RoutingPolicy::default()).map_err(|e| e.to_string())?,
        );
    }
    let candidate: RuleSet = serde_json::from_value(value).map_err(|e| e.to_string())?;
    candidate.validate()?;
    Ok(RulesMigrationPreview {
        candidate,
        from: 7,
        to: 8,
        routing_added,
        package_compatibility_review_required: true,
    })
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenderingRegistry {
    pub schema_version: u32,
    pub id: String,
    pub registrations: Vec<RenderingRegistration>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenderingRegistration {
    pub id: String,
    pub rule_set_id: String,
    pub projection_policy: ProjectionPolicy,
}
impl RenderingRegistry {
    pub fn validate(&self, rules: &[GraphRuleSet]) -> Result<(), String> {
        if self.schema_version != 1
            || self.registrations.is_empty()
            || self.registrations.len() > 128
        {
            return Err("Unsupported rendering registry version/limit".into());
        }
        graphic_id(&self.id)?;
        let mut ids = BTreeSet::new();
        for r in &self.registrations {
            registration_id(&r.id)?;
            if !ids.insert(&r.id) {
                return Err("Duplicate/unqualified rendering registration".into());
            }
            r.projection_policy.validate(true)?;
            let rule = rules
                .iter()
                .find(|rule| rule.id == r.rule_set_id)
                .ok_or("Rendering rule set is missing")?;
            if rule.projection != r.projection_policy {
                return Err("Rendering projection policy mismatch".into());
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RenderingStatus {
    Resolved,
    Unsupported,
    Unmanaged,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RenderingOrigin {
    Explicit,
    Inherited,
    Default,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenderingSelection {
    pub registration_id: String,
    pub rule_set_id: String,
    pub package_fingerprint: String,
    pub projection_policy: ProjectionPolicy,
    pub origin: RenderingOrigin,
    pub origin_binding: Binding,
    #[serde(deserialize_with = "crate::graph::nullable")]
    pub canonical_rendering: Option<Binding>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RenderingDiagnostic {
    pub code: String,
    pub message: String,
    pub binding: Binding,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenderingResolution {
    pub schema_version: u32,
    pub revision: u64,
    pub view_key: String,
    pub status: RenderingStatus,
    #[serde(deserialize_with = "crate::graph::nullable")]
    pub selection: Option<RenderingSelection>,
    pub diagnostics: Vec<RenderingDiagnostic>,
}
impl RenderingResolution {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1
            || self.revision > crate::MAX_WIRE_INTEGER
            || self.diagnostics.len() > 32
        {
            return Err("Invalid rendering resolution version/limit".into());
        }
        crate::identity(&self.view_key)?;
        if (self.status == RenderingStatus::Resolved) != self.selection.is_some()
            || (self.status == RenderingStatus::Unsupported && self.diagnostics.is_empty())
            || (self.status != RenderingStatus::Unsupported && !self.diagnostics.is_empty())
        {
            return Err("Inconsistent rendering resolution status".into());
        }
        if let Some(s) = &self.selection {
            registration_id(&s.registration_id)?;
            graphic_id(&s.rule_set_id)?;
            if s.package_fingerprint.len() != 64
                || !s
                    .package_fingerprint
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err("Invalid rendering package fingerprint".into());
            }
            s.projection_policy.validate(true)?;
            s.origin_binding.validate()?;
            if matches!(s.origin, RenderingOrigin::Default) != s.canonical_rendering.is_none() {
                return Err("Invalid rendering origin/target".into());
            }
            if let Some(b) = &s.canonical_rendering {
                b.validate()?;
            }
        }
        for d in &self.diagnostics {
            graphic_id(&d.code)?;
            if d.message.is_empty() || d.message.len() > 4096 {
                return Err("Rendering diagnostic message limit".into());
            }
            d.binding.validate()?;
        }
        Ok(())
    }
}
