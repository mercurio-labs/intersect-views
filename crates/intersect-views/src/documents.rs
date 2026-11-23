//! Handwritten M1 document shapes and structural validation only.
//! Class/function resolution and scope evaluation belong to later milestones.
use super::{DOCUMENT_VERSION, LayoutHints, identity};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const PRESENTATION_VERSION: u32 = 4;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExpandOption {
    pub id: String,
    pub label: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scope {
    pub schema_version: u32,
    pub ops: Vec<ScopeOp>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
pub enum ScopeOp {
    AddSeed {
        element: String,
    },
    Expand {
        element: String,
        relation: String,
        hops: u8,
    },
    Hide {
        element: String,
    },
    Collapse {
        element: String,
        context: Vec<String>,
    },
    RemoveSeed {
        element: String,
    },
}
impl Scope {
    pub fn validate(&self) -> Result<(), String> {
        version(self.schema_version)?;
        if self.ops.len() > 4096 {
            return Err("Scope exceeds 4096 operations".into());
        }
        for op in &self.ops {
            let element = match op {
                ScopeOp::AddSeed { element }
                | ScopeOp::Hide { element }
                | ScopeOp::RemoveSeed { element } => element,
                ScopeOp::Expand {
                    element,
                    relation,
                    hops,
                } => {
                    identity(relation)?;
                    if !(1..=8).contains(hops) {
                        return Err("Scope hops must be 1 to 8".into());
                    }
                    element
                }
                ScopeOp::Collapse { element, context } => {
                    for key in context {
                        identity(key)?;
                    }
                    element
                }
            };
            identity(element)?;
        }
        Ok(())
    }
}
fn version(value: u32) -> Result<(), String> {
    if value != DOCUMENT_VERSION {
        Err("Unsupported document version".into())
    } else {
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ViewDocument {
    pub schema_version: u32,
    pub key: String,
    pub name: String,
    pub rule_set: String,
    pub scope: Scope,
}
impl ViewDocument {
    pub fn validate(&self) -> Result<(), String> {
        version(self.schema_version)?;
        for text in [&self.key, &self.name, &self.rule_set] {
            identity(text)?;
        }
        self.scope.validate()
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Presentation {
    pub schema_version: u32,
    pub views: BTreeMap<String, ViewPresentation>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "form", rename_all = "camelCase", deny_unknown_fields)]
pub enum ViewPresentation {
    Graph {
        #[serde(rename = "packageFingerprint")]
        package_fingerprint: String,
        projection: String,
        positions: BTreeMap<String, Geometry>,
        #[serde(rename = "routeConstraints")]
        route_constraints: BTreeMap<String, super::RouteConstraint>,
        #[serde(rename = "labelPlacements")]
        label_placements: BTreeMap<String, super::LabelPlacement>,
        viewport: Viewport,
    },
    LaneGraph {
        #[serde(rename = "packageFingerprint")]
        package_fingerprint: String,
        projection: String,
        #[serde(rename = "laneOrder")]
        lane_order: Vec<String>,
        viewport: Viewport,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Geometry {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Viewport {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}
impl Presentation {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != PRESENTATION_VERSION {
            return Err(
                "Unsupported presentation version; export or reset the saved layout".into(),
            );
        }
        if self.views.len() > 128 {
            return Err("Presentation exceeds 128 views".into());
        }
        for view in self.views.values() {
            if let ViewPresentation::Graph {
                route_constraints,
                label_placements,
                ..
            } = view
            {
                if route_constraints.len() > super::MAX_ROUTED_EDGES
                    || label_placements.len() > 20000
                {
                    return Err("Saved routing or label placement budget exceeded".into());
                }
                for (id, constraint) in route_constraints {
                    identity(id)?;
                    constraint.validate()?;
                }
                for (id, placement) in label_placements {
                    identity(id)?;
                    placement.validate()?;
                }
            }
            let (fingerprint, projection) = match view {
                ViewPresentation::Graph {
                    package_fingerprint,
                    projection,
                    ..
                }
                | ViewPresentation::LaneGraph {
                    package_fingerprint,
                    projection,
                    ..
                } => (package_fingerprint, projection),
            };
            if fingerprint.len() != 64
                || !fingerprint
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err("Invalid presentation package fingerprint".into());
            }
            identity(projection)?;
            let (positions, viewport) = match view {
                ViewPresentation::Graph {
                    positions,
                    viewport,
                    ..
                } => (Some(positions), viewport),
                ViewPresentation::LaneGraph {
                    lane_order,
                    viewport,
                    ..
                } => {
                    if lane_order.len() > 128 {
                        return Err("Presentation lane order limit exceeded".into());
                    }
                    let mut seen = BTreeSet::new();
                    for id in lane_order {
                        identity(id)?;
                        if !seen.insert(id) {
                            return Err("Duplicate presentation lane".into());
                        }
                    }
                    (None, viewport)
                }
            };
            if positions.is_some_and(|p| p.len() > 5000) {
                return Err("Presentation exceeds 5000 positions".into());
            }
            for g in positions.into_iter().flat_map(|p| p.values()) {
                if ![g.x, g.y, g.width, g.height].iter().all(|n| n.is_finite())
                    || g.width < 1.0
                    || g.height < 1.0
                    || g.x.abs() > 1_000_000.0
                    || g.y.abs() > 1_000_000.0
                {
                    return Err("Invalid saved diagram position".into());
                }
            }
            let v = viewport;
            if ![v.x, v.y, v.zoom].iter().all(|n| n.is_finite()) || !(0.05..=4.0).contains(&v.zoom)
            {
                return Err("Invalid saved viewport".into());
            }
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(untagged, deny_unknown_fields)]
pub enum Slot {
    Function(String),
    Text {
        text: String,
    },
    SourceText {
        #[serde(rename = "sourceText")]
        source_text: bool,
    },
}
impl Slot {
    pub(crate) fn validate(&self) -> Result<(), String> {
        match self {
            Self::Function(name) => identity(name),
            Self::Text { .. } => Ok(()),
            Self::SourceText { source_text: true } => Ok(()),
            Self::SourceText { .. } => Err("sourceText must be true".into()),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphRuleSet {
    pub schema_version: u32,
    pub projection: crate::ProjectionPolicy,
    pub id: String,
    pub label: String,
    pub language: String,
    pub form: String,
    pub layout: LayoutHints,
    pub routing: super::RoutingPolicy,
    pub symbols: Vec<SymbolRule>,
    pub edges: Vec<EdgeRule>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SymbolRule {
    pub id: String,
    #[serde(rename = "match")]
    pub class: String,
    pub emit: String,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "non_null"
    )]
    pub notation: Option<String>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "non_null"
    )]
    pub title: Option<super::LabelRule>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "non_null"
    )]
    pub subtitle: Option<super::LabelRule>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "non_null"
    )]
    pub label: Option<super::LabelRule>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "non_null"
    )]
    pub side: Option<Slot>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "non_null"
    )]
    pub style_class: Option<Slot>,
    #[serde(default)]
    pub compartments: Vec<CompartmentRule>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "non_null"
    )]
    pub ports: Option<PortsRule>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "non_null"
    )]
    pub children: Option<SelectRule>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "non_null"
    )]
    pub regions: Option<super::RegionRule>,
    #[serde(default)]
    pub expand: Vec<ExpandRule>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub create: Vec<CreateRule>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "non_null"
    )]
    pub graphic: Option<super::GraphicRule>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateRule {
    pub tool: String,
    pub command: String,
    pub accepts: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectRule {
    pub command: String,
    pub source_accepts: String,
    pub target_accepts: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CompartmentRule {
    pub id: String,
    pub label: String,
    pub rows: String,
    pub row_label: super::LabelRule,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PortsRule {
    pub select: String,
    pub rule: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SelectRule {
    pub select: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExpandRule {
    pub id: String,
    pub label: String,
    pub select: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum EdgeRule {
    Element {
        id: String,
        per: String,
        select: String,
        notation: String,
        label: super::LabelRule,
        #[serde(rename = "sourcePath")]
        source_path: String,
        #[serde(rename = "targetPath")]
        target_path: String,
        anchor: String,
        #[serde(
            default,
            rename = "rootOnly",
            skip_serializing_if = "std::ops::Not::not"
        )]
        root_only: bool,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "non_null"
        )]
        connect: Option<ConnectRule>,
        #[serde(
            default,
            rename = "startMarker",
            skip_serializing_if = "Option::is_none",
            deserialize_with = "non_null"
        )]
        start_marker: Option<super::GraphicRule>,
        #[serde(
            default,
            rename = "endMarker",
            skip_serializing_if = "Option::is_none",
            deserialize_with = "non_null"
        )]
        end_marker: Option<super::GraphicRule>,
    },
    Reference {
        id: String,
        per: String,
        targets: String,
        notation: String,
        label: super::LabelRule,
        anchor: String,
        #[serde(
            default,
            rename = "rootOnly",
            skip_serializing_if = "std::ops::Not::not"
        )]
        root_only: bool,
        #[serde(
            default,
            skip_serializing_if = "Option::is_none",
            deserialize_with = "non_null"
        )]
        connect: Option<ConnectRule>,
        #[serde(
            default,
            rename = "startMarker",
            skip_serializing_if = "Option::is_none",
            deserialize_with = "non_null"
        )]
        start_marker: Option<super::GraphicRule>,
        #[serde(
            default,
            rename = "endMarker",
            skip_serializing_if = "Option::is_none",
            deserialize_with = "non_null"
        )]
        end_marker: Option<super::GraphicRule>,
    },
}
impl EdgeRule {
    pub fn markers(&self) -> [Option<&super::GraphicRule>; 2] {
        match self {
            Self::Element {
                start_marker,
                end_marker,
                ..
            }
            | Self::Reference {
                start_marker,
                end_marker,
                ..
            } => [start_marker.as_ref(), end_marker.as_ref()],
        }
    }
    pub fn connect(&self) -> Option<&ConnectRule> {
        match self {
            Self::Element { connect, .. } | Self::Reference { connect, .. } => connect.as_ref(),
        }
    }
    pub fn id(&self) -> &str {
        match self {
            Self::Element { id, .. } | Self::Reference { id, .. } => id,
        }
    }
}
impl GraphRuleSet {
    /// Structural contract validation. Opaque class/function names are resolved
    /// against a language only when the M3 evaluator is implemented.
    pub fn validate(&self) -> Result<(), String> {
        self.projection.validate(true)?;
        if self.schema_version != super::RULE_VERSION {
            return Err("Unsupported rule-set version".into());
        }
        self.routing.validate()?;
        if self.routing.trunks == super::TrunkPolicy::Siblings
            && !matches!(
                self.projection,
                crate::ProjectionPolicy::ContainmentTree { .. }
            )
        {
            return Err("Sibling trunks require a containment tree projection".into());
        }
        for text in [&self.id, &self.label, &self.language] {
            identity(text)?;
        }
        let outline = self.layout.strategy == "outline";
        let sequence = self.layout.strategy == "sequence";
        if self.form != "graph"
            || !(outline || sequence || self.layout.strategy == "layered")
            || !["RIGHT", "LEFT", "UP", "DOWN"].contains(&self.layout.direction.as_str())
        {
            return Err("Unsupported rule form or layout".into());
        }
        if (outline || sequence)
            && (!matches!(self.projection, crate::ProjectionPolicy::Nested)
                || (outline && !self.edges.is_empty())
                || self.symbols.iter().any(|symbol| {
                    symbol.emit != "node"
                        || symbol.ports.is_some()
                        || symbol.regions.is_some()
                        || !symbol.compartments.is_empty()
                        || !symbol.expand.is_empty()
                        || !symbol.create.is_empty()
                        || symbol.graphic.is_some()
                }))
        {
            return Err("Specialized view rules define only labels and nested nodes".into());
        }
        if let crate::ProjectionPolicy::ContainmentTree { edge_role, .. } = &self.projection
            && (self
                .symbols
                .iter()
                .any(|s| s.regions.is_some() || s.id == *edge_role)
                || self.edges.iter().any(|e| e.id() == edge_role))
        {
            return Err("Containment tree role collision or unsupported regions".into());
        }
        let mut ids = BTreeSet::new();
        let mut classes = BTreeSet::new();
        for symbol in &self.symbols {
            identity(&symbol.id)?;
            identity(&symbol.class)?;
            if !ids.insert(&symbol.id) || !classes.insert(&symbol.class) {
                return Err("Duplicate rule ID or match class".into());
            }
            if !["node", "port"].contains(&symbol.emit.as_str()) {
                return Err("Unsupported symbol emission".into());
            }
            if (symbol.emit == "port"
                && (symbol.title.is_some()
                    || symbol.subtitle.is_some()
                    || symbol.regions.is_some()
                    || symbol.children.is_some()
                    || symbol.ports.is_some()
                    || !symbol.compartments.is_empty()
                    || !symbol.expand.is_empty()))
                || (symbol.emit == "node" && (symbol.label.is_some() || symbol.side.is_some()))
            {
                return Err("Unsupported field for symbol emission".into());
            }
            if let Some(name) = &symbol.notation {
                identity(name)?;
            }
            if let Some(graphic) = &symbol.graphic {
                graphic.validate()?;
            }
            for slot in [&symbol.title, &symbol.subtitle, &symbol.label]
                .into_iter()
                .flatten()
            {
                slot.validate()?;
            }
            for s in [&symbol.side, &symbol.style_class].into_iter().flatten() {
                s.validate()?;
            }
            if let Some(r) = &symbol.regions {
                if symbol.emit != "node" || !ids.insert(&r.id) {
                    return Err("Invalid/duplicate region rule".into());
                }
                for s in [&r.id, &r.select, &r.children.select] {
                    identity(s)?;
                }
                if !["row", "column"].contains(&r.direction.as_str()) {
                    return Err("Unknown region direction".into());
                }
                r.label.validate()?;
            }
            let mut compartments = BTreeSet::new();
            for compartment in &symbol.compartments {
                identity(&compartment.id)?;
                if !compartments.insert(&compartment.id) {
                    return Err("Duplicate compartment rule ID".into());
                }
                identity(&compartment.rows)?;
                compartment.row_label.validate()?;
            }
            if let Some(ports) = &symbol.ports {
                identity(&ports.select)?;
                identity(&ports.rule)?;
            }
            if let Some(children) = &symbol.children {
                identity(&children.select)?;
            }
            let mut expansions = BTreeSet::new();
            let mut tools = BTreeSet::new();
            for create in &symbol.create {
                for name in [&create.tool, &create.command, &create.accepts] {
                    identity(name)?;
                }
                if symbol.emit != "node" || !tools.insert(&create.tool) {
                    return Err("Creation requires a node rule and unique tool IDs".into());
                }
            }
            for option in &symbol.expand {
                for text in [&option.id, &option.label, &option.select] {
                    identity(text)?;
                }
                if !expansions.insert(&option.id) {
                    return Err("Duplicate expansion ID".into());
                }
            }
        }
        let reserved: BTreeSet<&str> = ["select", "fit", "layout"]
            .into_iter()
            .chain(
                self.symbols
                    .iter()
                    .flat_map(|r| r.create.iter().map(|c| c.tool.as_str())),
            )
            .chain(
                self.edges
                    .iter()
                    .filter(|e| e.connect().is_some())
                    .map(|e| e.id()),
            )
            .collect();
        let mut label_tools = BTreeMap::new();
        for e in self.label_edits() {
            if reserved.contains(e.tool.as_str())
                || label_tools
                    .insert(&e.tool, &e.command)
                    .is_some_and(|c| c != &e.command)
            {
                return Err("Conflicting label edit tool".into());
            }
        }
        for symbol in &self.symbols {
            if let Some(ports) = &symbol.ports
                && !self
                    .symbols
                    .iter()
                    .any(|s| s.id == ports.rule && s.emit == "port")
            {
                return Err("Unknown port rule".into());
            }
        }
        for edge in &self.edges {
            for marker in edge.markers().into_iter().flatten() {
                marker.validate()?;
            }
            let (id, per, notation, label, anchor) = match edge {
                EdgeRule::Element {
                    id,
                    per,
                    select,
                    notation,
                    label,
                    source_path,
                    target_path,
                    anchor,
                    ..
                } => {
                    for name in [select, source_path, target_path] {
                        identity(name)?;
                    }
                    (id, per, notation, label, anchor)
                }
                EdgeRule::Reference {
                    id,
                    per,
                    targets,
                    notation,
                    label,
                    anchor,
                    ..
                } => {
                    identity(targets)?;
                    (id, per, notation, label, anchor)
                }
            };
            for name in [id, per, notation] {
                identity(name)?;
            }
            label.validate()?;
            if let Some(connect) = edge.connect() {
                for name in [
                    &connect.command,
                    &connect.source_accepts,
                    &connect.target_accepts,
                ] {
                    identity(name)?;
                }
            }
            if !ids.insert(id)
                || !self
                    .symbols
                    .iter()
                    .any(|s| s.id == *per && s.emit == "node")
                || !["owner", "root"].contains(&anchor.as_str())
            {
                return Err("Duplicate edge ID, unknown owner rule or invalid anchor".into());
            }
        }
        Ok(())
    }
}

fn non_null<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}
