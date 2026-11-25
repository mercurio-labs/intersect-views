//! M12 data-only graphical compositions. No model, DOM, filesystem or callbacks.
use crate::{Binding, Label, LabelPart, LabelRule, Slot};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const GRAPHICS_VERSION: u32 = 1;
pub const GRAPHICS_PARTS: usize = 50_000;
pub const GRAPHICS_PATH_COMMANDS: usize = 65_536;
pub const GRAPHICS_TEXT_BYTES: usize = 1_048_576;

pub fn graphic_id(id: &str) -> Result<(), String> {
    if id.is_empty() || id.len() > 256 || id.chars().any(char::is_control) {
        Err("Invalid graphical identity".into())
    } else {
        Ok(())
    }
}
pub fn graphic_number(n: f64) -> Result<(), String> {
    if n.is_finite() && n.abs() <= 1_000_000.0 {
        Ok(())
    } else {
        Err("Graphical number is nonfinite or exceeds extent".into())
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum GraphicValue {
    Bool(bool),
    Number(f64),
    String(String),
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ParameterType {
    String {
        default: String,
    },
    Bool {
        default: bool,
    },
    Number {
        default: f64,
    },
    Choice {
        values: Vec<String>,
        default: String,
    },
}
impl ParameterType {
    pub fn default_value(&self) -> GraphicValue {
        match self {
            Self::String { default } | Self::Choice { default, .. } => {
                GraphicValue::String(default.clone())
            }
            Self::Bool { default } => GraphicValue::Bool(*default),
            Self::Number { default } => GraphicValue::Number(*default),
        }
    }
    pub fn accepts(&self, value: &GraphicValue) -> bool {
        match (self, value) {
            (Self::String { .. }, GraphicValue::String(s)) => {
                s.len() <= 4096 && !s.chars().any(char::is_control)
            }
            (Self::Choice { values, .. }, GraphicValue::String(s)) => values.contains(s),
            (Self::Bool { .. }, GraphicValue::Bool(_)) => true,
            (Self::Number { .. }, GraphicValue::Number(n)) => graphic_number(*n).is_ok(),
            _ => false,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ParameterRule {
    Constant { value: GraphicValue },
    String { value: Slot },
    Bool { function: String },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ValueExpression {
    Constant { value: GraphicValue },
    Parameter { name: String },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum NumericExpression {
    Constant(f64),
    Expression(NumericOperation),
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
pub enum NumericOperation {
    Select {
        condition: BooleanExpression,
        #[serde(rename = "ifTrue")]
        if_true: Box<NumericExpression>,
        #[serde(rename = "ifFalse")]
        if_false: Box<NumericExpression>,
    },
    Parameter {
        name: String,
    },
    Width,
    Height,
    SlotWidth {
        slot: String,
    },
    SlotHeight {
        slot: String,
    },
    Add {
        left: Box<NumericExpression>,
        right: Box<NumericExpression>,
    },
    Subtract {
        left: Box<NumericExpression>,
        right: Box<NumericExpression>,
    },
    Multiply {
        left: Box<NumericExpression>,
        right: Box<NumericExpression>,
    },
    Divide {
        left: Box<NumericExpression>,
        right: Box<NumericExpression>,
    },
    Min {
        left: Box<NumericExpression>,
        right: Box<NumericExpression>,
    },
    Max {
        left: Box<NumericExpression>,
        right: Box<NumericExpression>,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum BooleanExpression {
    Constant(bool),
    Expression(BooleanOperation),
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
pub enum BooleanOperation {
    Parameter { name: String },
    Equal { name: String, value: GraphicValue },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Paint {
    Constant(String),
    Parameter(PaintParameter),
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaintParameter {
    pub parameter: String,
}
pub fn graphic_color(s: &str) -> bool {
    s == "none"
        || (s.starts_with('#')
            && matches!(s.len(), 7 | 9)
            && s[1..].bytes().all(|b| b.is_ascii_hexdigit()))
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GraphicRole {
    Node,
    Port,
    Marker,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ContentType {
    Text,
    Compartments,
    Children,
    Regions,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum ContentSource {
    Title,
    Subtitle,
    Label,
    Compartments,
    Children,
    Regions,
    Text { name: String },
}
impl ContentSource {
    pub fn content_type(&self) -> ContentType {
        match self {
            Self::Compartments => ContentType::Compartments,
            Self::Children => ContentType::Children,
            Self::Regions => ContentType::Regions,
            _ => ContentType::Text,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphicInstance {
    pub definition: String,
    pub parameters: BTreeMap<String, GraphicValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_parameters: Option<Vec<String>>,
    pub slots: BTreeMap<String, ContentSource>,
}
impl GraphicInstance {
    pub fn validate(&self) -> Result<(), String> {
        graphic_id(&self.definition)?;
        if self.parameters.len() > 32 || self.slots.len() > 32 {
            return Err("Graphic instance argument limit".into());
        }
        for (name, value) in &self.parameters {
            graphic_id(name)?;
            match value {
                GraphicValue::Number(n) => graphic_number(*n)?,
                GraphicValue::String(s) if s.len() > 4096 || s.chars().any(char::is_control) => {
                    return Err("Invalid graphical String value".into());
                }
                _ => {}
            }
        }
        if let Some(source) = &self.source_parameters {
            let mut seen = BTreeSet::new();
            if source.len() > 32
                || source
                    .iter()
                    .any(|n| !self.parameters.contains_key(n) || !seen.insert(n))
            {
                return Err("Invalid source parameter provenance".into());
            }
        }
        for (name, source) in &self.slots {
            graphic_id(name)?;
            if let ContentSource::Text { name } = source {
                graphic_id(name)?;
            }
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphicRule {
    pub definition: String,
    pub parameters: BTreeMap<String, ParameterRule>,
    pub slots: BTreeMap<String, ContentSource>,
    pub text: BTreeMap<String, TextBlockRule>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextBlockRule {
    pub runs: Vec<TextRunRule>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextRunRule {
    pub id: String,
    pub label: LabelRule,
}
impl GraphicRule {
    pub fn validate(&self) -> Result<(), String> {
        graphic_id(&self.definition)?;
        if self.parameters.len() > 32 || self.slots.len() > 32 || self.text.len() > 32 {
            return Err("Graphic rule argument limit".into());
        }
        for (name, parameter) in &self.parameters {
            graphic_id(name)?;
            match parameter {
                ParameterRule::Constant {
                    value: GraphicValue::Number(n),
                } => graphic_number(*n)?,
                ParameterRule::Constant {
                    value: GraphicValue::String(s),
                } if s.len() > 4096 || s.chars().any(char::is_control) => {
                    return Err("Invalid graphical String constant".into());
                }
                ParameterRule::String { value } => value.validate()?,
                ParameterRule::Bool { function } => graphic_id(function)?,
                _ => {}
            }
        }
        for (name, source) in &self.slots {
            graphic_id(name)?;
            if let ContentSource::Text { name } = source
                && !self.text.contains_key(name)
            {
                return Err("Graphic rule maps an unknown TextBlock".into());
            }
        }
        for (name, block) in &self.text {
            graphic_id(name)?;
            if block.runs.len() > 64 {
                return Err("TextBlock rule run limit".into());
            }
            let mut ids = BTreeSet::new();
            for run in &block.runs {
                graphic_id(&run.id)?;
                if !ids.insert(&run.id) {
                    return Err("Duplicate TextBlock rule run ID".into());
                }
                if !run.label.edits().is_empty() {
                    return Err("TextBlock source editing is not yet a qualified command target; use existing Label targets".into());
                }
                let mut label = run.label.clone();
                fn clean(slot: &mut Slot) -> Result<(), String> {
                    if let Slot::Text { text } = slot {
                        let normalized = text.replace("\r\n", "\n");
                        if normalized.contains(['\r', '\t']) {
                            return Err("Invalid TextBlock constant separators".into());
                        }
                        *text = normalized.replace('\n', " ");
                    }
                    Ok(())
                }
                match &mut label {
                    LabelRule::Scalar(slot) => clean(slot)?,
                    LabelRule::Parts(parts) => {
                        for part in &mut parts.parts {
                            clean(&mut part.text)?;
                        }
                    }
                }
                label.validate()?;
            }
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextBlock {
    pub runs: Vec<TextRun>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextRun {
    pub id: String,
    pub parts: Vec<LabelPart>,
}
impl TextBlock {
    pub fn from_label(label: &Label) -> Self {
        Self {
            runs: vec![TextRun {
                id: "label".into(),
                parts: label.parts.clone(),
            }],
        }
    }
    pub fn validate(&self) -> Result<usize, String> {
        if self.runs.len() > 64 {
            return Err("TextBlock run limit exceeded".into());
        }
        let mut ids = BTreeSet::new();
        let mut bytes = 0;
        for run in &self.runs {
            graphic_id(&run.id)?;
            if !ids.insert(run.id.clone()) || run.parts.len() > 32 {
                return Err("Duplicate run or TextBlock part limit".into());
            }
            let mut length = 0;
            for p in &run.parts {
                graphic_id(&p.id)?;
                if !ids.insert(p.id.clone()) {
                    return Err("Duplicate TextBlock logical part".into());
                }
                if p.text.contains(['\r', '\t']) {
                    return Err("TextBlock requires LF separators and no tabs".into());
                }
                length += p.text.len();
                if let Some(binding) = &p.binding {
                    binding.validate()?;
                }
                if p.edit_tool.is_some() && p.binding.is_none() {
                    return Err("Unbound text cannot be edited".into());
                }
            }
            if length > 4096 {
                return Err("TextBlock logical label byte limit".into());
            }
            bytes += length;
        }
        Ok(bytes)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SymbolLibrary {
    pub schema_version: u32,
    pub id: String,
    pub imports: Vec<String>,
    pub definitions: Vec<SymbolDefinition>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SymbolDefinition {
    pub id: String,
    pub version: String,
    pub role: GraphicRole,
    pub parameters: BTreeMap<String, ParameterType>,
    pub slots: BTreeMap<String, ContentType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<GraphicSize>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub properties: Vec<crate::SymbolProperty>,
    pub root: GraphicPart,
    #[serde(deserialize_with = "crate::graph::nullable")]
    pub connection_anchor: Option<String>,
    /// The anchor of a port symbol that sits on its owner's border. Without it
    /// the connection anchor does, and the whole symbol hangs inside the owner.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub border_anchor: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphicSize {
    pub minimum_width: NumericExpression,
    pub preferred_width: NumericExpression,
    pub minimum_height: NumericExpression,
    pub preferred_height: NumericExpression,
}
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GraphicDash {
    #[default]
    Solid,
    Dashed,
    Dotted,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GraphicPart {
    pub id: String,
    #[serde(deserialize_with = "crate::graph::nullable")]
    pub when: Option<BooleanExpression>,
    pub anchors: Vec<GraphicAnchor>,
    pub content: GraphicContent,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<crate::GraphicStyle>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GraphicAnchor {
    pub id: String,
    pub x: NumericExpression,
    pub y: NumericExpression,
    pub dx: NumericExpression,
    pub dy: NumericExpression,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum GraphicContent {
    Frame {
        padding: f64,
        radius: f64,
        fill: Paint,
        stroke: Paint,
        #[serde(rename = "strokeWidth")]
        stroke_width: f64,
        #[serde(default)]
        dash: GraphicDash,
        children: Vec<GraphicPart>,
    },
    Stack {
        direction: StackDirection,
        align: GraphicAlignment,
        gap: f64,
        children: Vec<GraphicPart>,
    },
    Overlay {
        children: Vec<GraphicPart>,
    },
    Geometry {
        geometry: GraphicGeometry,
        fill: Paint,
        stroke: Paint,
        #[serde(rename = "strokeWidth")]
        stroke_width: f64,
        #[serde(default)]
        dash: GraphicDash,
    },
    Text {
        slot: String,
        size: f64,
        weight: u16,
        italic: bool,
        align: GraphicAlignment,
        wrap: bool,
        color: Paint,
    },
    Content {
        slot: String,
    },
    Use {
        definition: String,
        parameters: BTreeMap<String, ValueExpression>,
        slots: BTreeMap<String, String>,
    },
    Transform {
        x: NumericExpression,
        y: NumericExpression,
        rotate: NumericExpression,
        #[serde(rename = "scaleX")]
        scale_x: NumericExpression,
        #[serde(rename = "scaleY")]
        scale_y: NumericExpression,
        child: Box<GraphicPart>,
    },
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum StackDirection {
    Row,
    Column,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum GraphicAlignment {
    Start,
    Center,
    End,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum GraphicGeometry {
    Rectangle {
        width: NumericExpression,
        height: NumericExpression,
        radius: f64,
    },
    Ellipse {
        width: NumericExpression,
        height: NumericExpression,
    },
    Polyline {
        width: NumericExpression,
        height: NumericExpression,
        points: Vec<GraphicPoint>,
        closed: bool,
    },
    Path {
        width: NumericExpression,
        height: NumericExpression,
        commands: Vec<PathCommand>,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GraphicPoint {
    pub x: NumericExpression,
    pub y: NumericExpression,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum PathCommand {
    Move {
        x: NumericExpression,
        y: NumericExpression,
    },
    Line {
        x: NumericExpression,
        y: NumericExpression,
    },
    Quadratic {
        cx: NumericExpression,
        cy: NumericExpression,
        x: NumericExpression,
        y: NumericExpression,
    },
    Cubic {
        cx1: NumericExpression,
        cy1: NumericExpression,
        cx2: NumericExpression,
        cy2: NumericExpression,
        x: NumericExpression,
        y: NumericExpression,
    },
    Close,
}

fn parameter<'a>(
    definition: &'a SymbolDefinition,
    name: &str,
) -> Result<&'a ParameterType, String> {
    definition
        .parameters
        .get(name)
        .ok_or_else(|| format!("Unknown graphic parameter {name}"))
}
fn numeric(
    expr: &NumericExpression,
    definition: &SymbolDefinition,
    depth: usize,
    allow_height: bool,
) -> Result<(), String> {
    if depth > 16 {
        return Err("Graphical expression depth limit".into());
    }
    match expr {
        NumericExpression::Constant(n) => graphic_number(*n),
        NumericExpression::Expression(NumericOperation::Parameter { name }) => {
            if matches!(parameter(definition, name)?, ParameterType::Number { .. }) {
                Ok(())
            } else {
                Err("Numeric expression needs Number parameter".into())
            }
        }
        NumericExpression::Expression(
            NumericOperation::SlotWidth { slot } | NumericOperation::SlotHeight { slot },
        ) => {
            if definition.slots.contains_key(slot) {
                Ok(())
            } else {
                Err("Unknown measured graphical slot".into())
            }
        }
        NumericExpression::Expression(NumericOperation::Height) if !allow_height => {
            Err("Measurement cannot depend on its unresolved height".into())
        }
        NumericExpression::Expression(NumericOperation::Width | NumericOperation::Height) => Ok(()),
        NumericExpression::Expression(NumericOperation::Select {
            condition,
            if_true,
            if_false,
        }) => {
            boolean(condition, definition)?;
            numeric(if_true, definition, depth + 1, allow_height)?;
            numeric(if_false, definition, depth + 1, allow_height)
        }
        NumericExpression::Expression(op) => {
            let (left, right) = match op {
                NumericOperation::Add { left, right }
                | NumericOperation::Subtract { left, right }
                | NumericOperation::Multiply { left, right }
                | NumericOperation::Divide { left, right }
                | NumericOperation::Min { left, right }
                | NumericOperation::Max { left, right } => (left, right),
                _ => return Err("Invalid numeric expression".into()),
            };
            numeric(left, definition, depth + 1, allow_height)?;
            numeric(right, definition, depth + 1, allow_height)
        }
    }
}
fn sizing_dependency(expression: &NumericExpression, width: bool) -> Result<(), String> {
    if let NumericExpression::Expression(op) = expression {
        match op {
            NumericOperation::Height => return Err("Sizing depends on unresolved height".into()),
            NumericOperation::Width | NumericOperation::SlotHeight { .. } if width => {
                return Err("Cyclic width/wrapping constraint".into());
            }
            NumericOperation::Select {
                if_true, if_false, ..
            } => {
                sizing_dependency(if_true, width)?;
                sizing_dependency(if_false, width)?;
            }
            NumericOperation::Add { left, right }
            | NumericOperation::Subtract { left, right }
            | NumericOperation::Multiply { left, right }
            | NumericOperation::Divide { left, right }
            | NumericOperation::Min { left, right }
            | NumericOperation::Max { left, right } => {
                sizing_dependency(left, width)?;
                sizing_dependency(right, width)?;
            }
            _ => {}
        }
    }
    Ok(())
}
fn paint(value: &Paint, definition: &SymbolDefinition) -> Result<(), String> {
    match value {
        Paint::Constant(s) if graphic_color(s) => Ok(()),
        Paint::Parameter(p)
            if matches!(
                parameter(definition, &p.parameter)?,
                ParameterType::String { .. } | ParameterType::Choice { .. }
            ) =>
        {
            Ok(())
        }
        _ => Err("Invalid graphical paint".into()),
    }
}
fn boolean(value: &BooleanExpression, definition: &SymbolDefinition) -> Result<(), String> {
    match value {
        BooleanExpression::Constant(_) => Ok(()),
        BooleanExpression::Expression(BooleanOperation::Parameter { name })
            if matches!(parameter(definition, name)?, ParameterType::Bool { .. }) =>
        {
            Ok(())
        }
        BooleanExpression::Expression(BooleanOperation::Equal { name, value })
            if parameter(definition, name)?.accepts(value) =>
        {
            Ok(())
        }
        _ => Err("Invalid graphical condition".into()),
    }
}
fn compatible(from: &ParameterType, to: &ParameterType) -> bool {
    match (from, to) {
        (ParameterType::String { .. }, ParameterType::String { .. })
        | (ParameterType::Bool { .. }, ParameterType::Bool { .. })
        | (ParameterType::Number { .. }, ParameterType::Number { .. }) => true,
        (ParameterType::Choice { .. }, ParameterType::String { .. }) => true,
        (ParameterType::Choice { values: a, .. }, ParameterType::Choice { values: b, .. }) => {
            a.iter().all(|v| b.contains(v))
        }
        _ => false,
    }
}
#[derive(Default)]
pub struct GraphicCost {
    pub parts: usize,
    pub path_commands: usize,
}
impl GraphicCost {
    pub fn add(&mut self, other: &Self) -> Result<(), String> {
        self.parts = self
            .parts
            .checked_add(other.parts)
            .ok_or("Graphical cost overflow")?;
        self.path_commands = self
            .path_commands
            .checked_add(other.path_commands)
            .ok_or("Path cost overflow")?;
        if self.parts > GRAPHICS_PARTS || self.path_commands > GRAPHICS_PATH_COMMANDS {
            return Err("Expanded graphical scene limit exceeded".into());
        }
        Ok(())
    }
}
pub struct GraphicDefinitions<'a> {
    pub definitions: BTreeMap<&'a str, &'a SymbolDefinition>,
}
impl<'a> GraphicDefinitions<'a> {
    pub fn new(libraries: &'a [SymbolLibrary]) -> Result<Self, String> {
        if libraries.len() > 64 {
            return Err("Symbol library limit".into());
        }
        let mut result = Self {
            definitions: BTreeMap::new(),
        };
        let mut library_ids = BTreeSet::new();
        for library in libraries {
            graphic_id(&library.id)?;
            if library.schema_version != GRAPHICS_VERSION || !library_ids.insert(&library.id) {
                return Err("Invalid/duplicate symbol library".into());
            }
            if library.imports.len() > 64 {
                return Err("Symbol import limit".into());
            }
            for definition in &library.definitions {
                graphic_id(&definition.id)?;
                graphic_id(&definition.version)?;
                let prefix = format!("{}/", library.id);
                if definition
                    .id
                    .strip_prefix(&prefix)
                    .is_none_or(|name| name.is_empty() || name.contains('/'))
                    || result
                        .definitions
                        .insert(&definition.id, definition)
                        .is_some()
                {
                    return Err("Duplicate or unqualified symbol definition".into());
                }
            }
        }
        if result.definitions.len() > 256 {
            return Err("Symbol definition limit".into());
        }
        for library in libraries {
            for import in &library.imports {
                if !library_ids.contains(import) || import == &library.id {
                    return Err("Missing/self symbol import".into());
                }
            }
            for definition in &library.definitions {
                result
                    .validate_definition(definition, &library.id, &library.imports)
                    .map_err(|e| {
                        format!("Library {}, definition {}: {e}", library.id, definition.id)
                    })?;
            }
        }
        for id in result.definitions.keys() {
            result.cost(id, &mut Vec::new(), 0)?;
            let definition = result.definition(id)?;
            crate::validate_properties(definition)?;
            let defaults = definition
                .parameters
                .iter()
                .map(|(name, p)| (name.clone(), p.default_value()))
                .collect();
            result.evaluated_paints(&definition.root, &defaults)?;
            result.evaluated_size(definition, &defaults)?;
            result.evaluated_geometry(&definition.root, &defaults)?;
            let names = result.anchor_names(&result.definition(id)?.root)?;
            if result
                .definition(id)?
                .connection_anchor
                .as_ref()
                .is_some_and(|name| !names.contains(name))
            {
                return Err("Missing connection anchor".into());
            }
            if result
                .definition(id)?
                .border_anchor
                .as_ref()
                .is_some_and(|name| !names.contains(name))
            {
                return Err("Missing border anchor".into());
            }
        }
        Ok(result)
    }
    pub fn definition(&self, id: &str) -> Result<&'a SymbolDefinition, String> {
        self.definitions
            .get(id)
            .copied()
            .ok_or_else(|| format!("Unknown symbol definition {id}"))
    }
    fn validate_definition(
        &self,
        d: &SymbolDefinition,
        library: &str,
        imports: &[String],
    ) -> Result<(), String> {
        if d.parameters.len() > 32 || d.slots.len() > 32 {
            return Err("Symbol parameter/slot limit".into());
        }
        for (name, p) in &d.parameters {
            graphic_id(name)?;
            if let ParameterType::Choice { values, .. } = p
                && (values.is_empty()
                    || values.len() > 64
                    || values.iter().collect::<BTreeSet<_>>().len() != values.len()
                    || values
                        .iter()
                        .any(|s| s.len() > 4096 || s.chars().any(char::is_control)))
            {
                return Err("Invalid Choice parameter".into());
            }
            if !p.accepts(&p.default_value()) {
                return Err("Invalid parameter default".into());
            }
        }
        for name in d.slots.keys() {
            graphic_id(name)?;
        }
        if d.role != GraphicRole::Node && d.slots.values().any(|t| *t != ContentType::Text) {
            return Err("Port/marker cannot contain semantic children".into());
        }
        if let Some(size) = &d.size {
            for (expression, width) in [
                (&size.minimum_width, true),
                (&size.preferred_width, true),
                (&size.minimum_height, false),
                (&size.preferred_height, false),
            ] {
                numeric(expression, d, 0, false)?;
                sizing_dependency(expression, width)?;
            }
        }
        let mut ids = BTreeSet::new();
        let mut anchors = BTreeSet::new();
        self.part(&d.root, d, (library, imports), 0, &mut ids, &mut anchors)?;
        let mut used = BTreeMap::new();
        fn slots(part: &GraphicPart, used: &mut BTreeMap<String, usize>) {
            match &part.content {
                GraphicContent::Text { slot, .. } | GraphicContent::Content { slot } => {
                    *used.entry(slot.clone()).or_default() += 1
                }
                GraphicContent::Use { slots, .. } => {
                    for slot in slots.values() {
                        *used.entry(slot.clone()).or_default() += 1;
                    }
                }
                GraphicContent::Frame { children, .. }
                | GraphicContent::Stack { children, .. }
                | GraphicContent::Overlay { children } => {
                    for child in children {
                        slots(child, used);
                    }
                }
                GraphicContent::Transform { child, .. } => slots(child, used),
                _ => {}
            }
        }
        slots(&d.root, &mut used);
        for (name, kind) in &d.slots {
            let count = used.get(name).copied().unwrap_or_default();
            if count == 0 || (*kind != ContentType::Text && count > 1) {
                return Err(format!("Unused or multiply-owned graphical slot {name}"));
            }
        }
        if ids.len() > 256 {
            return Err("Authored graphical part limit".into());
        }
        if let Some(anchor) = &d.connection_anchor {
            graphic_id(anchor)?;
        } else if d.role != GraphicRole::Node {
            return Err("Port/marker requires a connection anchor".into());
        }
        if let Some(anchor) = &d.border_anchor {
            graphic_id(anchor)?;
            if d.role != GraphicRole::Port {
                return Err("Only a port symbol has a border anchor".into());
            }
        }
        Ok(())
    }
    fn part(
        &self,
        p: &GraphicPart,
        d: &SymbolDefinition,
        library_context: (&str, &[String]),
        depth: usize,
        ids: &mut BTreeSet<String>,
        anchors: &mut BTreeSet<String>,
    ) -> Result<(), String> {
        let (library, imports) = library_context;
        if depth > 16 {
            return Err("Graphical part depth limit".into());
        }
        graphic_id(&p.id)?;
        crate::validate_style(p, d)?;
        if !ids.insert(p.id.clone()) {
            return Err("Duplicate authored graphical part ID".into());
        }
        if let Some(condition) = &p.when {
            boolean(condition, d)?;
        }
        if p.anchors.len() > 32 {
            return Err("Anchor limit".into());
        }
        for a in &p.anchors {
            graphic_id(&a.id)?;
            if !anchors.insert(a.id.clone()) {
                return Err("Duplicate local anchor ID".into());
            }
            for e in [&a.x, &a.y, &a.dx, &a.dy] {
                numeric(e, d, 0, true)?;
            }
        }
        let mut children: Vec<&GraphicPart> = Vec::new();
        match &p.content {
            GraphicContent::Frame {
                padding,
                radius,
                fill,
                stroke,
                stroke_width,
                children: c,
                ..
            } => {
                if *stroke_width > 100.0 {
                    return Err("Invalid graphical stroke width".into());
                }
                for n in [padding, radius, stroke_width] {
                    graphic_number(*n)?;
                    if *n < 0.0 {
                        return Err("Negative frame geometry".into());
                    }
                }
                paint(fill, d)?;
                paint(stroke, d)?;
                children.extend(c);
            }
            GraphicContent::Stack {
                gap, children: c, ..
            } => {
                graphic_number(*gap)?;
                if *gap < 0.0 {
                    return Err("Negative stack gap".into());
                }
                children.extend(c);
            }
            GraphicContent::Overlay { children: c } => children.extend(c),
            GraphicContent::Transform {
                x,
                y,
                rotate,
                scale_x,
                scale_y,
                child,
            } => {
                for e in [x, y, rotate, scale_x, scale_y] {
                    numeric(e, d, 0, false)?;
                }
                for scale in [scale_x, scale_y] {
                    if matches!(scale, NumericExpression::Constant(n) if *n == 0.0) {
                        return Err("Singular graphical transform".into());
                    }
                }
                children.push(child);
            }
            GraphicContent::Text {
                slot,
                size,
                weight,
                color,
                ..
            } => {
                if d.slots.get(slot) != Some(&ContentType::Text)
                    || !size.is_finite()
                    || !(6.0..=96.0).contains(size)
                    || ![400, 500, 600, 700].contains(weight)
                {
                    return Err("Invalid text part/slot/style".into());
                }
                paint(color, d)?;
            }
            GraphicContent::Content { slot } => {
                if !d.slots.contains_key(slot) {
                    return Err("Unknown content slot".into());
                }
            }
            GraphicContent::Use {
                definition,
                parameters,
                slots,
            } => {
                let target = self.definition(definition)?;
                let source_library = definition
                    .rsplit_once('/')
                    .map(|(s, _)| s)
                    .ok_or("Unqualified symbol use")?;
                if source_library != library && !imports.iter().any(|s| s == source_library) {
                    return Err("Symbol use requires an explicit library import".into());
                }
                if target.role != d.role {
                    return Err("Incompatible reused graphic role".into());
                }
                for (name, v) in parameters {
                    let expected = parameter(target, name)?;
                    let valid = match v {
                        ValueExpression::Constant { value } => expected.accepts(value),
                        ValueExpression::Parameter { name } => {
                            compatible(parameter(d, name)?, expected)
                        }
                    };
                    if !valid {
                        return Err("Incompatible forwarded graphical parameter".into());
                    }
                }
                if slots.len() != target.slots.len()
                    || slots.iter().any(|(name, source)| {
                        !target.slots.contains_key(name)
                            || !d.slots.contains_key(source)
                            || target.slots.get(name) != d.slots.get(source)
                    })
                {
                    return Err("Incompatible forwarded graphical slots".into());
                }
            }
            GraphicContent::Geometry {
                geometry,
                fill,
                stroke,
                stroke_width,
                ..
            } => {
                paint(fill, d)?;
                paint(stroke, d)?;
                graphic_number(*stroke_width)?;
                if *stroke_width < 0.0 || *stroke_width > 100.0 {
                    return Err("Invalid graphical stroke width".into());
                }
                let (width, height) = match geometry {
                    GraphicGeometry::Rectangle {
                        width,
                        height,
                        radius,
                    } => {
                        graphic_number(*radius)?;
                        if *radius < 0.0 {
                            return Err("Negative radius".into());
                        }
                        (width, height)
                    }
                    GraphicGeometry::Ellipse { width, height } => (width, height),
                    GraphicGeometry::Polyline {
                        width,
                        height,
                        points,
                        ..
                    } => {
                        if points.len() < 2 || points.len() > 2048 {
                            return Err("Polyline point limit".into());
                        }
                        for p in points {
                            numeric(&p.x, d, 0, true)?;
                            numeric(&p.y, d, 0, true)?;
                        }
                        (width, height)
                    }
                    GraphicGeometry::Path {
                        width,
                        height,
                        commands,
                    } => {
                        if commands.is_empty()
                            || commands.len() > 2048
                            || !matches!(commands.first(), Some(PathCommand::Move { .. }))
                        {
                            return Err("Invalid path command sequence/limit".into());
                        }
                        for command in commands {
                            for e in command.expressions() {
                                numeric(e, d, 0, true)?;
                            }
                        }
                        (width, height)
                    }
                };
                numeric(width, d, 0, false)?;
                numeric(height, d, 0, false)?;
                for size in [width, height] {
                    if matches!(size, NumericExpression::Constant(n) if *n <= 0.0) {
                        return Err("Nonpositive graphical dimension".into());
                    }
                }
            }
        }
        if children.len() > 256 {
            return Err("Graphical child limit".into());
        }
        for child in children {
            self.part(child, d, library_context, depth + 1, ids, anchors)?;
        }
        Ok(())
    }
    pub fn instance(&self, instance: &GraphicInstance, role: GraphicRole) -> Result<(), String> {
        let d = self.definition(&instance.definition)?;
        if d.role != role
            || instance.parameters.len() != d.parameters.len()
            || instance.slots.len() != d.slots.len()
        {
            return Err("Graphic instance role/arguments mismatch".into());
        }
        instance.validate()?;
        for p in &d.properties {
            crate::property_value(
                d,
                p,
                instance
                    .parameters
                    .get(&p.parameter)
                    .ok_or("Missing property parameter")?,
            )?;
        }
        for (name, value) in &instance.parameters {
            if !parameter(d, name)?.accepts(value) {
                return Err(format!("Invalid graphical parameter {name}"));
            }
        }
        let mut content_owners = BTreeSet::new();
        for (name, source) in &instance.slots {
            if d.slots.get(name) != Some(&source.content_type()) {
                return Err("Invalid graphical slot mapping".into());
            }
            if source.content_type() != ContentType::Text
                && !content_owners.insert(format!("{:?}", source.content_type()))
            {
                return Err("Multiple slots claim the same semantic content".into());
            }
            if role != GraphicRole::Node
                && !matches!(source, ContentSource::Label | ContentSource::Text { .. })
            {
                return Err("Port/marker slot requires its own text".into());
            }
            if role == GraphicRole::Node && matches!(source, ContentSource::Label) {
                return Err("Node has no port/edge label slot".into());
            }
            if let ContentSource::Text { name } = source {
                graphic_id(name)?;
            }
        }
        self.evaluated_paints(&d.root, &instance.parameters)?;
        self.evaluated_size(d, &instance.parameters)?;
        self.evaluated_geometry(&d.root, &instance.parameters)
    }
    fn evaluated_paints(
        &self,
        part: &GraphicPart,
        values: &BTreeMap<String, GraphicValue>,
    ) -> Result<(), String> {
        crate::evaluated_style(part, values)?;
        let check = |p: &Paint| -> Result<(), String> {
            let value = match p {
                Paint::Constant(s) => s,
                Paint::Parameter(p) => match values.get(&p.parameter) {
                    Some(GraphicValue::String(s)) => s,
                    _ => return Err("Missing String graphical paint value".into()),
                },
            };
            if graphic_color(value) {
                Ok(())
            } else {
                Err("Invalid evaluated graphical paint".into())
            }
        };
        match &part.content {
            GraphicContent::Frame {
                fill,
                stroke,
                children,
                ..
            } => {
                check(fill)?;
                check(stroke)?;
                for child in children {
                    self.evaluated_paints(child, values)?;
                }
            }
            GraphicContent::Geometry { fill, stroke, .. } => {
                check(fill)?;
                check(stroke)?;
            }
            GraphicContent::Text { color, .. } => check(color)?,
            GraphicContent::Stack { children, .. } | GraphicContent::Overlay { children } => {
                for child in children {
                    self.evaluated_paints(child, values)?;
                }
            }
            GraphicContent::Transform { child, .. } => self.evaluated_paints(child, values)?,
            GraphicContent::Use {
                definition,
                parameters,
                ..
            } => {
                let d = self.definition(definition)?;
                let mut forwarded: BTreeMap<_, _> = d
                    .parameters
                    .iter()
                    .map(|(k, p)| (k.clone(), p.default_value()))
                    .collect();
                for (name, expr) in parameters {
                    let value = match expr {
                        ValueExpression::Constant { value } => value.clone(),
                        ValueExpression::Parameter { name } => values
                            .get(name)
                            .ok_or("Missing forwarded parameter")?
                            .clone(),
                    };
                    if !parameter(d, name)?.accepts(&value) {
                        return Err("Invalid forwarded graphical value".into());
                    }
                    forwarded.insert(name.clone(), value);
                }
                for p in &d.properties {
                    crate::property_value(
                        d,
                        p,
                        forwarded
                            .get(&p.parameter)
                            .ok_or("Missing forwarded property parameter")?,
                    )?;
                }
                self.evaluated_paints(&d.root, &forwarded)?;
            }
            GraphicContent::Content { .. } => {}
        }
        Ok(())
    }
    fn anchor_names(&self, part: &GraphicPart) -> Result<BTreeSet<String>, String> {
        let mut names: BTreeSet<String> = part.anchors.iter().map(|a| a.id.clone()).collect();
        let mut extend = |more: BTreeSet<String>| -> Result<(), String> {
            for name in more {
                if !names.insert(name) {
                    return Err("Duplicate expanded anchor".into());
                }
            }
            Ok(())
        };
        match &part.content {
            GraphicContent::Frame { children, .. }
            | GraphicContent::Stack { children, .. }
            | GraphicContent::Overlay { children } => {
                for child in children {
                    extend(self.anchor_names(child)?)?;
                }
            }
            GraphicContent::Transform { child, .. } => extend(self.anchor_names(child)?)?,
            GraphicContent::Use { definition, .. } => extend(
                self.anchor_names(&self.definition(definition)?.root)?
                    .into_iter()
                    .map(|name| format!("{}/{name}", part.id))
                    .collect(),
            )?,
            _ => {}
        }
        Ok(names)
    }
    pub fn cost(
        &self,
        id: &str,
        path: &mut Vec<String>,
        depth: usize,
    ) -> Result<GraphicCost, String> {
        if depth > 8 || path.iter().any(|p| p == id) {
            return Err("Graphical reuse cycle/depth limit".into());
        }
        path.push(id.into());
        let result = self.part_cost(&self.definition(id)?.root, path, depth);
        path.pop();
        result
    }
    fn part_cost(
        &self,
        part: &GraphicPart,
        path: &mut Vec<String>,
        depth: usize,
    ) -> Result<GraphicCost, String> {
        let mut cost = GraphicCost {
            parts: 1,
            path_commands: 0,
        };
        match &part.content {
            GraphicContent::Frame { children, .. }
            | GraphicContent::Stack { children, .. }
            | GraphicContent::Overlay { children } => {
                for child in children {
                    cost.add(&self.part_cost(child, path, depth)?)?;
                }
            }
            GraphicContent::Transform { child, .. } => {
                cost.add(&self.part_cost(child, path, depth)?)?
            }
            GraphicContent::Use { definition, .. } => {
                cost.add(&self.cost(definition, path, depth + 1)?)?
            }
            GraphicContent::Geometry {
                geometry: GraphicGeometry::Path { commands, .. },
                ..
            } => cost.path_commands = commands.len(),
            GraphicContent::Geometry {
                geometry: GraphicGeometry::Polyline { points, .. },
                ..
            } => cost.path_commands = points.len(),
            _ => {}
        }
        Ok(cost)
    }
}
impl PathCommand {
    fn expressions(&self) -> Vec<&NumericExpression> {
        match self {
            Self::Move { x, y } | Self::Line { x, y } => vec![x, y],
            Self::Quadratic { cx, cy, x, y } => vec![cx, cy, x, y],
            Self::Cubic {
                cx1,
                cy1,
                cx2,
                cy2,
                x,
                y,
            } => vec![cx1, cy1, cx2, cy2, x, y],
            Self::Close => vec![],
        }
    }
}
pub fn text_binding<'a>(block: &'a TextBlock, part: &str) -> Option<&'a Binding> {
    block
        .runs
        .iter()
        .flat_map(|r| &r.parts)
        .find(|p| p.id == part)
        .and_then(|p| p.binding.as_ref())
}
