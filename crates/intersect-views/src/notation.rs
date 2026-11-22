//! Data-only notation validation, mirrored in visualization/notation.ts.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NotationProfile {
    pub schema_version: u32,
    pub id: String,
    pub shapes: BTreeMap<String, Value>,
    #[serde(default)]
    pub edges: BTreeMap<String, Value>,
    #[serde(default)]
    pub style_classes: BTreeMap<String, Value>,
    #[serde(default)]
    pub icons: BTreeMap<String, String>,
}
fn color(value: &Value) -> bool {
    let Some(s) = value.as_str() else {
        return false;
    };
    matches!(
        s,
        "neutral" | "usage" | "definition" | "package" | "transparent"
    ) || (s.starts_with('#')
        && matches!(s.len(), 7 | 9)
        && s[1..].bytes().all(|c| c.is_ascii_hexdigit()))
}
fn style(value: &Value, node: bool, partial: bool) -> Result<(), String> {
    let object = value.as_object().ok_or("Invalid notation object")?;
    let allowed = if node {
        &["shape", "fill", "stroke", "radius"][..]
    } else {
        &["line", "stroke", "startMarker", "endMarker"][..]
    };
    if object.keys().any(|k| !allowed.contains(&k.as_str()))
        || (!partial
            && allowed
                .iter()
                .filter(|k| **k != "radius")
                .any(|k| !object.contains_key(*k)))
    {
        return Err("Invalid notation fields".into());
    }
    for (key, value) in object {
        let valid = match key.as_str() {
            "fill" | "stroke" => color(value),
            "radius" => value
                .as_f64()
                .is_some_and(|n| n.is_finite() && (0.0..=100.0).contains(&n)),
            "shape" => value
                .as_str()
                .is_some_and(|s| matches!(s, "rectangle" | "rounded" | "ellipse" | "diamond")),
            "line" => value
                .as_str()
                .is_some_and(|s| matches!(s, "solid" | "dashed" | "dotted")),
            _ => value
                .as_str()
                .is_some_and(|s| matches!(s, "none" | "arrow" | "triangle")),
        };
        if !valid {
            return Err(format!("Invalid notation {key}"));
        }
    }
    Ok(())
}
impl NotationProfile {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != 1 || self.id.trim().is_empty() {
            return Err("Invalid notation identity".into());
        }
        for keys in [
            self.shapes.keys().collect::<Vec<_>>(),
            self.edges.keys().collect(),
            self.style_classes.keys().collect(),
            self.icons.keys().collect(),
        ] {
            if keys.len() > 256 || keys.iter().any(|k| k.trim().is_empty()) {
                return Err("Invalid notation map".into());
            }
        }
        for value in self.shapes.values() {
            style(value, true, false)?;
        }
        for value in self.edges.values() {
            style(value, false, false)?;
        }
        for value in self.style_classes.values() {
            let object = value.as_object().ok_or("Invalid notation override")?;
            for (k, v) in object {
                match k.as_str() {
                    "node" => style(v, true, true)?,
                    "edge" => style(v, false, true)?,
                    _ => return Err("Unknown notation override".into()),
                }
            }
        }
        if self
            .icons
            .values()
            .any(|v| v.trim().is_empty() || v.chars().count() > 16)
        {
            return Err("Invalid notation icon".into());
        }
        Ok(())
    }
}
