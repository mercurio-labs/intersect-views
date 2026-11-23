//! Data-only visual parameter descriptors. No model fields or callbacks.
use crate::{
    GraphicContent, GraphicPart, GraphicValue, ParameterType, SymbolDefinition, graphic_color,
    graphic_id, graphic_number,
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum PropertyEditor {
    Color,
    Bool,
    Choice,
    Number { minimum: f64, maximum: f64 },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SymbolProperty {
    pub id: String,
    pub parameter: String,
    pub label: String,
    pub group: String,
    pub description: String,
    pub editor: PropertyEditor,
    pub editable: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StyleProperty {
    FillEnabled,
    Fill,
    Stroke,
    StrokeWidth,
    Dash,
    Radius,
    TextColor,
    FontSize,
    FontWeight,
    Italic,
    Alignment,
    Wrap,
}
pub type GraphicStyle = BTreeMap<StyleProperty, crate::PaintParameter>;

pub fn property_value(
    d: &SymbolDefinition,
    p: &SymbolProperty,
    value: &GraphicValue,
) -> Result<(), String> {
    let parameter = d
        .parameters
        .get(&p.parameter)
        .ok_or("Property references an undeclared parameter")?;
    if !parameter.accepts(value) {
        return Err(format!("Property {} has the wrong value type", p.id));
    }
    let valid = match (&p.editor, parameter, value) {
        (PropertyEditor::Color, ParameterType::String { .. }, GraphicValue::String(s)) => {
            graphic_color(s)
        }
        (PropertyEditor::Bool, ParameterType::Bool { .. }, GraphicValue::Bool(_)) => true,
        (PropertyEditor::Choice, ParameterType::Choice { .. }, GraphicValue::String(_)) => true,
        (
            PropertyEditor::Number { minimum, maximum },
            ParameterType::Number { .. },
            GraphicValue::Number(n),
        ) => n >= minimum && n <= maximum,
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(format!("Property {} violates its editor bounds/type", p.id))
    }
}
fn text(value: &str, limit: usize) -> Result<(), String> {
    if value.is_empty() || value.len() > limit || value.chars().any(char::is_control) {
        Err("Invalid property display text".into())
    } else {
        Ok(())
    }
}
fn references(value: &serde_json::Value, name: &str) -> bool {
    match value {
        serde_json::Value::Object(map) => {
            map.get("parameter").and_then(|v| v.as_str()) == Some(name)
                || (map.get("name").and_then(|v| v.as_str()) == Some(name)
                    && (matches!(
                        map.get("op").and_then(|v| v.as_str()),
                        Some("parameter" | "equal")
                    ) || map.get("kind").and_then(|v| v.as_str()) == Some("parameter")))
                || map.values().any(|v| references(v, name))
        }
        serde_json::Value::Array(items) => items.iter().any(|v| references(v, name)),
        _ => false,
    }
}
fn visual_uses(part: &GraphicPart, name: &str) -> Result<usize, String> {
    let mut value = serde_json::to_value(part).map_err(|e| e.to_string())?;
    let map = value.as_object_mut().ok_or("Invalid graphical part")?;
    let mut count = part
        .style
        .as_ref()
        .map_or(0, |s| s.values().filter(|v| v.parameter == name).count());
    map.remove("style");
    let content = map
        .get_mut("content")
        .and_then(|v| v.as_object_mut())
        .ok_or("Invalid graphical content")?;
    let fields: &[&str] = match part.content {
        GraphicContent::Frame { .. } | GraphicContent::Geometry { .. } => &["fill", "stroke"],
        GraphicContent::Text { .. } => &["color"],
        _ => &[],
    };
    for field in fields {
        if content
            .get(*field)
            .and_then(|v| v.get("parameter"))
            .and_then(|v| v.as_str())
            == Some(name)
        {
            content.remove(*field);
            count += 1;
        }
    }
    content.remove("children");
    content.remove("child");
    if references(&value, name) {
        return Err("A visual property parameter cannot control visibility, anchors, geometry, forwarding or semantic content; declare it on the consuming definition".into());
    }
    match &part.content {
        GraphicContent::Frame { children, .. }
        | GraphicContent::Stack { children, .. }
        | GraphicContent::Overlay { children } => {
            for child in children {
                count += visual_uses(child, name)?;
            }
        }
        GraphicContent::Transform { child, .. } => count += visual_uses(child, name)?,
        _ => {}
    }
    Ok(count)
}
pub fn validate_properties(d: &SymbolDefinition) -> Result<(), String> {
    if d.properties.len() > 32 {
        return Err("Property descriptor limit exceeded".into());
    }
    let mut ids = BTreeSet::new();
    let mut parameters = BTreeSet::new();
    for p in &d.properties {
        graphic_id(&p.id)?;
        graphic_id(&p.parameter)?;
        text(&p.label, 256)?;
        text(&p.group, 128)?;
        text(&p.description, 2048)?;
        if !ids.insert(&p.id) || !parameters.insert(&p.parameter) {
            return Err("Duplicate property descriptor or parameter".into());
        }
        if let PropertyEditor::Number { minimum, maximum } = &p.editor {
            graphic_number(*minimum)?;
            graphic_number(*maximum)?;
            if minimum > maximum {
                return Err("Reversed property number bounds".into());
            }
        }
        let parameter = d
            .parameters
            .get(&p.parameter)
            .ok_or("Property references an undeclared parameter")?;
        property_value(d, p, &parameter.default_value())?;
        if d.size
            .as_ref()
            .is_some_and(|s| serde_json::to_value(s).is_ok_and(|v| references(&v, &p.parameter)))
        {
            return Err("Visual property controls authored sizing expressions".into());
        }
        if visual_uses(&d.root, &p.parameter)? == 0 {
            return Err("Property parameter has no visual consumer".into());
        }
    }
    Ok(())
}
pub fn validate_style(part: &GraphicPart, d: &SymbolDefinition) -> Result<(), String> {
    let Some(style) = &part.style else {
        return Ok(());
    };
    for (key, reference) in style {
        graphic_id(&reference.parameter)?;
        let p = d
            .properties
            .iter()
            .find(|p| p.parameter == reference.parameter)
            .ok_or("Style parameter needs a declared visual property")?;
        let appearance = matches!(
            part.content,
            GraphicContent::Frame { .. } | GraphicContent::Geometry { .. }
        );
        let is_text = matches!(part.content, GraphicContent::Text { .. });
        let number = |low: f64, high: f64| matches!(p.editor,PropertyEditor::Number{minimum,maximum} if minimum>=low&&maximum<=high);
        let choice = |allowed: &[&str]| {
            matches!(d.parameters.get(&p.parameter),Some(ParameterType::Choice{values,..}) if values.iter().all(|v|allowed.contains(&v.as_str())))
                && matches!(p.editor, PropertyEditor::Choice)
        };
        let valid = match key {
            StyleProperty::FillEnabled => appearance && matches!(p.editor, PropertyEditor::Bool),
            StyleProperty::Fill | StyleProperty::Stroke => {
                appearance && matches!(p.editor, PropertyEditor::Color)
            }
            StyleProperty::StrokeWidth => appearance && number(0.0, 100.0),
            StyleProperty::Radius => {
                (matches!(part.content, GraphicContent::Frame { .. })
                    || matches!(
                        part.content,
                        GraphicContent::Geometry {
                            geometry: crate::GraphicGeometry::Rectangle { .. },
                            ..
                        }
                    ))
                    && number(0.0, 128.0)
            }
            StyleProperty::Dash => appearance && choice(&["solid", "dashed", "dotted"]),
            StyleProperty::TextColor => is_text && matches!(p.editor, PropertyEditor::Color),
            StyleProperty::FontSize => is_text && number(6.0, 96.0),
            StyleProperty::FontWeight => is_text && number(100.0, 900.0),
            StyleProperty::Italic | StyleProperty::Wrap => {
                is_text && matches!(p.editor, PropertyEditor::Bool)
            }
            StyleProperty::Alignment => is_text && choice(&["start", "center", "end"]),
        };
        if !valid {
            return Err(format!(
                "Style property {key:?} has an incompatible consumer/editor"
            ));
        }
    }
    Ok(())
}
pub fn evaluated_style(
    part: &GraphicPart,
    values: &BTreeMap<String, GraphicValue>,
) -> Result<(), String> {
    if let Some(style) = &part.style {
        for (key, p) in style {
            let value = values
                .get(&p.parameter)
                .ok_or("Missing evaluated style parameter")?;
            let valid = match (key, value) {
                (
                    StyleProperty::FillEnabled | StyleProperty::Italic | StyleProperty::Wrap,
                    GraphicValue::Bool(_),
                ) => true,
                (
                    StyleProperty::Fill | StyleProperty::Stroke | StyleProperty::TextColor,
                    GraphicValue::String(s),
                ) => graphic_color(s),
                (StyleProperty::StrokeWidth, GraphicValue::Number(n)) => (0.0..=100.0).contains(n),
                (StyleProperty::Radius, GraphicValue::Number(n)) => (0.0..=128.0).contains(n),
                (StyleProperty::FontSize, GraphicValue::Number(n)) => (6.0..=96.0).contains(n),
                (StyleProperty::FontWeight, GraphicValue::Number(n)) => (100.0..=900.0).contains(n),
                (StyleProperty::Dash, GraphicValue::String(s)) => {
                    ["solid", "dashed", "dotted"].contains(&s.as_str())
                }
                (StyleProperty::Alignment, GraphicValue::String(s)) => {
                    ["start", "center", "end"].contains(&s.as_str())
                }
                _ => false,
            };
            if !valid {
                return Err(format!("Invalid evaluated style property {key:?}"));
            }
        }
    }
    Ok(())
}

pub fn require_property_capability(
    library: &crate::SymbolLibrary,
    requires: &[String],
) -> Result<(), String> {
    if library.definitions.iter().any(|d| !d.properties.is_empty())
        && !requires.iter().any(|c| c == "views.symbolProperties.v1")
    {
        Err("Property descriptors require views.symbolProperties.v1".into())
    } else {
        Ok(())
    }
}

/// Persisted display scalars. Contextual descriptor bounds are checked when evaluated.
pub type SymbolOverrides = BTreeMap<String, BTreeMap<String, GraphicValue>>;
pub fn validate_symbol_overrides(value: &SymbolOverrides) -> Result<(), String> {
    if value.len() > 20000 {
        return Err("Symbol property target limit".into());
    }
    let mut count = 0;
    let mut bytes = 0;
    for (id, props) in value {
        crate::identity(id)?;
        if props.len() > 32 {
            return Err("Symbol property count limit".into());
        }
        bytes += id.len();
        if bytes > 1048576 {
            return Err("Symbol property value budget".into());
        }
        for (key, value) in props {
            if key.len() != 73
                || !key.starts_with("property:")
                || !key.as_bytes()[9..]
                    .iter()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b))
            {
                return Err("Malformed qualified property identity".into());
            }
            let size = match value {
                GraphicValue::Number(n) if n.is_finite() && n.abs() <= 1_000_000.0 => 16,
                GraphicValue::Bool(_) => 16,
                GraphicValue::String(s)
                    if s.len() <= 4096
                        && !s
                            .chars()
                            .any(|c| c <= '\u{1f}' || ('\u{7f}'..='\u{9f}').contains(&c)) =>
                {
                    s.len()
                }
                _ => return Err("Invalid property scalar".into()),
            };
            bytes += key.len() + size + 64;
            count += 1;
            if count > 64000 || bytes > 1048576 {
                return Err("Symbol property value budget".into());
            }
        }
    }
    Ok(())
}
