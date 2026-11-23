//! Handwritten, serializable renderer-neutral visualization contracts.
//! This crate knows no language classes, parser, filesystem or UI framework.
use serde::{Deserialize, Serialize};

pub const VERSION: u32 = 7;
pub const RULE_VERSION: u32 = 8;
mod routing;
pub use routing::*;
mod graph;
pub use graph::*;
mod graphics;
mod graphics_values;
pub use graphics::*;
mod presentation_package;
pub use presentation_package::*;
mod lane;
pub use lane::*;
mod grid;
pub use grid::*;
pub const DOCUMENT_VERSION: u32 = 1;
mod documents;
mod notation;
pub use documents::*;
pub use notation::NotationProfile;
pub const MAX_WIRE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Position {
    pub line: usize,
    pub character: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Range {
    pub start: Position,
    pub end: Position,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    /// Stable within the supported declaration path contract; ambiguous paths fail.
    pub key: String,
    /// Snapshot-local engine identity. Never use this as a persisted symbol key.
    pub element_id: String,
    pub context: Vec<String>,
    pub uri: String,
    pub range: Range,
    pub read_only: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct View {
    pub key: String,
    pub name: String,
    pub kind: String,
    pub binding: Binding,
    pub owners: Vec<Owner>,
    pub details: Vec<Field>,
    pub problems: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Owner {
    pub key: String,
    pub label: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Compartment {
    pub id: String,
    pub label: String,
    pub rows: Vec<Row>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Row {
    pub id: String,
    pub label: Label,
    pub binding: Binding,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Field {
    pub label: String,
    pub binding: Binding,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Node {
    pub id: String,
    pub rule: String,
    pub style_class: String,
    pub expand: Vec<ExpandOption>,
    pub collapsed: bool,
    pub notation: String,
    pub title: Label,
    pub subtitle: Label,
    pub binding: Binding,
    pub compartments: Vec<Compartment>,
    pub children: Vec<Node>,
    #[serde(deserialize_with = "graph::nullable")]
    pub regions: Option<RegionSet>,
    pub ports: Vec<Port>,
    #[serde(deserialize_with = "graph::nullable")]
    pub graphic: Option<GraphicInstance>,
    pub text: std::collections::BTreeMap<String, TextBlock>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Port {
    pub id: String,
    pub rule: String,
    pub label: Label,
    pub side: String,
    pub binding: Binding,
    #[serde(deserialize_with = "graph::nullable")]
    pub graphic: Option<GraphicInstance>,
    pub text: std::collections::BTreeMap<String, TextBlock>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Edge {
    pub id: String,
    pub rule: String,
    pub style_class: String,
    pub notation: String,
    pub label: Label,
    pub source: String,
    pub target: String,
    #[serde(deserialize_with = "required_nullable_string")]
    pub branch_group: Option<String>,
    pub binding: Binding,
    #[serde(deserialize_with = "graph::nullable")]
    pub start_marker: Option<GraphicInstance>,
    #[serde(deserialize_with = "graph::nullable")]
    pub end_marker: Option<GraphicInstance>,
    pub text: std::collections::BTreeMap<String, TextBlock>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EndpointProxy {
    pub id: String,
    pub display_owner: String,
    pub binding: Binding,
    pub label: Label,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GraphScene {
    pub schema_version: u32,
    pub form: String,
    pub rule_set: String,
    pub revision: u64,
    pub layout: LayoutHints,
    pub routing: RoutingPolicy,
    pub endpoint_proxies: Vec<EndpointProxy>,
    pub view: View,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub palette: Palette,
    pub problems: Vec<String>,
}

/// Rendering hints, not language semantics. The provider chooses the direction.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LayoutHints {
    pub strategy: String,
    pub direction: String,
}
impl Default for LayoutHints {
    fn default() -> Self {
        Self {
            strategy: "layered".into(),
            direction: "RIGHT".into(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ViewCatalog {
    pub schema_version: u32,
    pub revision: u64,
    pub views: Vec<View>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ToolCapability {
    pub tool_id: String,
    pub enabled: bool,
    pub reason: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SceneResponse {
    pub scene: Scene,
    pub capabilities: Vec<ToolCapability>,
    pub presentation: PresentationContext,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PrepareCommand {
    pub revision: u64,
    pub view_key: String,
    pub owner_key: String,
    pub tool_id: String,
    pub arguments: std::collections::BTreeMap<String, String>,
    #[serde(default)]
    pub palette: Option<Palette>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<Scope>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreparedEdit {
    pub schema_version: u32,
    pub token: String,
    pub base_revision: u64,
    pub next_revision: u64,
    pub patches: Vec<SourcePatch>,
    pub created: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TargetResponse {
    pub revision: u64,
    pub view_key: String,
    pub tool_id: String,
    #[serde(deserialize_with = "required_nullable_string")]
    pub source: Option<String>,
    pub symbols: Vec<String>,
}
fn required_nullable_string<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}
impl TargetResponse {
    pub fn validate(&self) -> Result<(), String> {
        revision(self.revision)?;
        identity(&self.view_key)?;
        identity(&self.tool_id)?;
        if let Some(source) = &self.source {
            identity(source)?;
        }
        let mut seen = std::collections::BTreeSet::new();
        if self.symbols.len() > 1500 {
            return Err("Targets exceed node and port limits".into());
        }
        for symbol in &self.symbols {
            identity(symbol)?;
            if !seen.insert(symbol) {
                return Err("Duplicate target symbol".into());
            }
        }
        Ok(())
    }
}

/// Finite, caller-adjustable presentation budgets. Domain providers can impose
/// stricter profiles without adding domain dependencies to this contract crate.
#[derive(Clone, Copy, Debug)]
pub struct SceneLimits {
    pub nodes: usize,
    pub ports: usize,
    pub edges: usize,
    pub rows: usize,
    pub depth: usize,
}
impl Default for SceneLimits {
    fn default() -> Self {
        Self {
            nodes: 500,
            ports: 1000,
            edges: 2000,
            rows: 5000,
            depth: 16,
        }
    }
}
fn identity(id: &str) -> Result<(), String> {
    if id.is_empty() {
        Err("A wire identity is empty".into())
    } else {
        Ok(())
    }
}
fn revision(value: u64) -> Result<(), String> {
    if value > MAX_WIRE_INTEGER {
        Err("Revision exceeds the portable JSON integer range".into())
    } else {
        Ok(())
    }
}
impl Range {
    pub fn validate(&self) -> Result<(), String> {
        if [
            self.start.line,
            self.start.character,
            self.end.line,
            self.end.character,
        ]
        .iter()
        .any(|n| *n as u128 > MAX_WIRE_INTEGER as u128)
            || (self.end.line, self.end.character) < (self.start.line, self.start.character)
        {
            return Err("Invalid UTF-16 source range".into());
        }
        Ok(())
    }
}
impl Binding {
    pub fn validate(&self) -> Result<(), String> {
        identity(&self.key)?;
        identity(&self.element_id)?;
        identity(&self.uri)?;
        self.range.validate()?;
        for context in &self.context {
            identity(context)?;
        }
        Ok(())
    }
}
impl View {
    pub fn validate(&self) -> Result<(), String> {
        identity(&self.key)?;
        identity(&self.name)?;
        identity(&self.kind)?;
        self.binding.validate()?;
        let mut owners = std::collections::BTreeSet::new();
        for owner in &self.owners {
            identity(&owner.key)?;
            identity(&owner.label)?;
            if !owners.insert(&owner.key) {
                return Err("Duplicate view owner identity".into());
            }
        }
        for detail in &self.details {
            detail.binding.validate()?;
        }
        Ok(())
    }
}
impl ViewCatalog {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != DOCUMENT_VERSION {
            return Err("Unsupported view catalog version".into());
        }
        revision(self.revision)?;
        let mut views = std::collections::BTreeSet::new();
        for view in &self.views {
            view.validate()?;
            if !views.insert(&view.key) {
                return Err("Duplicate view identity".into());
            }
        }
        Ok(())
    }
}
impl GraphScene {
    pub fn validate(&self) -> Result<(), String> {
        self.validate_with_limits(SceneLimits::default())
    }
    pub fn validate_with_limits(&self, limits: SceneLimits) -> Result<(), String> {
        if self.schema_version != VERSION {
            return Err("Unsupported scene version".into());
        }
        revision(self.revision)?;
        self.routing.validate()?;
        self.view.validate()?;
        self.palette.validate()?;
        identity(&self.rule_set)?;
        let outline = self.layout.strategy == "outline";
        let sequence = self.layout.strategy == "sequence";
        if self.form != "graph" || !(outline || sequence || self.layout.strategy == "layered") {
            return Err("Unsupported scene form or layout strategy".into());
        }
        if !["RIGHT", "LEFT", "UP", "DOWN"].contains(&self.layout.direction.as_str()) {
            return Err("Unsupported layout direction".into());
        }
        if outline && (!self.edges.is_empty() || !self.endpoint_proxies.is_empty()) {
            return Err("Outline scenes contain only nested nodes".into());
        }
        if sequence && (!self.endpoint_proxies.is_empty() || self.nodes.len() != 1) {
            return Err("Sequence scenes require one scenario without endpoint proxies".into());
        }
        struct Audit {
            nested_labels: bool,
            sequence: bool,
            events: std::collections::BTreeSet<String>,
            limits: SceneLimits,
            counts: [usize; 3],
            regions: usize,
            parts: usize,
            text_bytes: usize,
            actions: std::collections::BTreeSet<String>,
            ids: std::collections::BTreeSet<String>,
            endpoints: std::collections::BTreeSet<String>,
            collapsed_owners: std::collections::BTreeMap<String, Binding>,
        }
        impl Audit {
            fn text(
                &mut self,
                blocks: &std::collections::BTreeMap<String, TextBlock>,
                owner: &Binding,
            ) -> Result<(), String> {
                if blocks.len() > 32 {
                    return Err("Scene TextBlock map limit".into());
                }
                for (name, block) in blocks {
                    graphic_id(name)?;
                    self.text_bytes += block.validate()?;
                    if self.text_bytes > GRAPHICS_TEXT_BYTES {
                        return Err("Scene TextBlock aggregate byte limit".into());
                    }
                    for part in block.runs.iter().flat_map(|r| &r.parts) {
                        self.add(&part.id, false)?;
                        self.parts += 1;
                        if self.parts > 20_000 {
                            return Err("Graph logical parts limit".into());
                        }
                        if part
                            .binding
                            .as_ref()
                            .is_some_and(|b| b.context != owner.context)
                            || part.edit_tool.is_some()
                        {
                            return Err(
                                "Invalid/unqualified TextBlock binding or edit target".into()
                            );
                        }
                    }
                }
                Ok(())
            }
            fn add(&mut self, id: &str, endpoint: bool) -> Result<(), String> {
                identity(id)?;
                if !self.ids.insert(id.into()) {
                    return Err(format!("Duplicate scene identity: {id}"));
                }
                if endpoint {
                    self.endpoints.insert(id.into());
                }
                Ok(())
            }
            fn label(&mut self, label: &Label, owner: &Binding) -> Result<(), String> {
                label.validate()?;
                self.parts += label.parts.len();
                if self.parts > 20000 {
                    return Err("Graph label parts limit exceeded".into());
                }
                for p in &label.parts {
                    self.add(&p.id, false)?;
                    if let Some(b) = &p.binding
                        && b.context != owner.context
                    {
                        return Err("Label binding context mismatch".into());
                    }
                    if p.edit_tool
                        .as_ref()
                        .is_some_and(|t| !self.actions.contains(t))
                    {
                        return Err("Label edit tool missing from action palette".into());
                    }
                }
                Ok(())
            }
            fn node(&mut self, node: &Node, depth: usize) -> Result<(), String> {
                self.counts[0] += 1;
                if depth > self.limits.depth || self.counts[0] > self.limits.nodes {
                    return Err("Scene node or nesting budget exceeded".into());
                }
                if self.nested_labels
                    && (!node.ports.is_empty()
                        || node.regions.is_some()
                        || !node.compartments.is_empty()
                        || !node.expand.is_empty()
                        || node.graphic.is_some()
                        || !node.text.is_empty())
                {
                    return Err(
                        "Outline and sequence nodes contain only labels and nested nodes".into(),
                    );
                }
                if self.sequence {
                    if depth > 2 || node.collapsed {
                        return Err(
                            "Sequence hierarchy requires scenario, lifelines, and events".into(),
                        );
                    }
                    if depth == 2 {
                        self.events.insert(node.id.clone());
                    }
                }
                self.add(&node.id, true)?;
                identity(&node.rule)?;
                let mut expansions = std::collections::BTreeSet::new();
                for option in &node.expand {
                    identity(&option.id)?;
                    identity(&option.label)?;
                    if !expansions.insert(&option.id) {
                        return Err("Duplicate expand option identity".into());
                    }
                }
                node.binding.validate()?;
                if node.collapsed {
                    self.collapsed_owners
                        .insert(node.id.clone(), node.binding.clone());
                }
                if let Some(graphic) = &node.graphic {
                    graphic.validate()?;
                }
                self.text(&node.text, &node.binding)?;
                self.label(&node.title, &node.binding)?;
                self.label(&node.subtitle, &node.binding)?;
                if node.collapsed
                    && (!node.children.is_empty()
                        || !node.ports.is_empty()
                        || node.regions.as_ref().is_some_and(|r| !r.items.is_empty()))
                {
                    return Err("Collapsed node has hidden content".into());
                }
                for port in &node.ports {
                    self.counts[1] += 1;
                    if self.counts[1] > self.limits.ports {
                        return Err("Scene port budget exceeded".into());
                    }
                    self.add(&port.id, true)?;
                    identity(&port.rule)?;
                    port.binding.validate()?;
                    if let Some(graphic) = &port.graphic {
                        graphic.validate()?;
                    }
                    self.text(&port.text, &port.binding)?;
                    self.label(&port.label, &port.binding)?;
                    if !["NORTH", "SOUTH", "WEST", "EAST"].contains(&port.side.as_str()) {
                        return Err("Unsupported port side".into());
                    }
                }
                for compartment in &node.compartments {
                    self.add(&compartment.id, false)?;
                    for row in &compartment.rows {
                        self.add(&row.id, false)?;
                        self.counts[2] += 1;
                        if self.counts[2] > self.limits.rows {
                            return Err("Scene row budget exceeded".into());
                        }
                        row.binding.validate()?;
                        self.label(&row.label, &row.binding)?;
                    }
                }
                let mut membership = std::collections::BTreeSet::new();
                for child in &node.children {
                    if !membership.insert(&child.binding.element_id) {
                        return Err("Duplicate direct membership".into());
                    }
                    self.node(child, depth + 1)?;
                }
                if let Some(set) = &node.regions {
                    if !["row", "column"].contains(&set.direction.as_str()) || set.items.len() > 16
                    {
                        return Err("Region direction/per-node limit".into());
                    }
                    for r in &set.items {
                        self.regions += 1;
                        if self.regions > 256 || depth + 1 > self.limits.depth {
                            return Err("Region count/nesting limit exceeded".into());
                        }
                        if membership.contains(&r.binding.element_id) {
                            return Err("Region/node membership collision".into());
                        }
                        self.add(&r.id, false)?;
                        identity(&r.rule)?;
                        r.binding.validate()?;
                        if r.collapsed {
                            self.collapsed_owners
                                .insert(r.id.clone(), r.binding.clone());
                        }
                        self.label(&r.label, &r.binding)?;
                        if r.collapsed && !r.children.is_empty() {
                            return Err("Collapsed region has children".into());
                        }
                        for c in &r.children {
                            if !membership.insert(&c.binding.element_id) {
                                return Err("graph.region.membership".into());
                            }
                            self.node(c, depth + 2)?;
                        }
                    }
                }
                Ok(())
            }
        }
        let mut audit = Audit {
            limits,
            nested_labels: outline || sequence,
            sequence,
            events: Default::default(),
            counts: [0; 3],
            regions: 0,
            parts: 0,
            text_bytes: 0,
            actions: self
                .palette
                .groups
                .iter()
                .flat_map(|g| &g.entries)
                .filter(|t| t.gesture == "action")
                .map(|t| t.id.clone())
                .collect(),
            ids: Default::default(),
            endpoints: Default::default(),
            collapsed_owners: Default::default(),
        };
        for node in &self.nodes {
            audit.node(node, 0)?;
        }
        if self.endpoint_proxies.len() > limits.nodes.saturating_add(limits.ports)
            || audit
                .endpoints
                .len()
                .saturating_add(self.endpoint_proxies.len())
                > limits.nodes.saturating_add(limits.ports)
        {
            return Err("Scene endpoint proxy budget exceeded".into());
        }
        for proxy in &self.endpoint_proxies {
            audit.add(&proxy.id, true)?;
            proxy.binding.validate()?;
            let mut nearest: Option<(&str, usize)> = None;
            let mut ambiguous = false;
            for (id, owner) in &audit.collapsed_owners {
                let depth = owner.context.len();
                if proxy.binding.context.len() > depth
                    && proxy.binding.context[..depth] == owner.context
                    && proxy.binding.context[depth] == owner.key
                {
                    match nearest {
                        Some((_, previous)) if previous > depth => {}
                        Some((_, previous)) if previous == depth => ambiguous = true,
                        _ => {
                            nearest = Some((id, depth));
                            ambiguous = false;
                        }
                    }
                }
            }
            if ambiguous || nearest.is_none_or(|(id, _)| id != proxy.display_owner) {
                return Err("Proxy has no unique nearest visible collapsed owner".into());
            }
            if proxy.label.parts.iter().any(|p| p.edit_tool.is_some()) {
                return Err("Endpoint proxy cannot carry a semantic edit target".into());
            }
            audit.label(&proxy.label, &proxy.binding)?;
        }
        let mut branch_sources = std::collections::BTreeMap::new();
        if self.edges.len() > limits.edges {
            return Err("Scene edge budget exceeded".into());
        }
        for edge in &self.edges {
            if sequence
                && (!matches!(edge.notation.as_str(), "message" | "precedence")
                    || !audit.events.contains(&edge.source)
                    || !audit.events.contains(&edge.target)
                    || edge.branch_group.is_some()
                    || edge.start_marker.is_some()
                    || edge.end_marker.is_some()
                    || !edge.text.is_empty())
            {
                return Err("Sequence edges must bind events as messages or precedence".into());
            }
            audit.add(&edge.id, false)?;
            identity(&edge.rule)?;
            if let Some(group) = &edge.branch_group {
                identity(group)?;
                if self.routing.trunks != TrunkPolicy::Siblings
                    || branch_sources
                        .insert(group, &edge.source)
                        .is_some_and(|source| source != &edge.source)
                {
                    return Err("Invalid branch group policy or common source".into());
                }
            }
            edge.binding.validate()?;
            for graphic in [&edge.start_marker, &edge.end_marker].into_iter().flatten() {
                graphic.validate()?;
            }
            audit.text(&edge.text, &edge.binding)?;
            audit.label(&edge.label, &edge.binding)?;
            if !audit.endpoints.contains(&edge.source) || !audit.endpoints.contains(&edge.target) {
                return Err(format!("Unbound scene edge: {}", edge.id));
            }
        }
        if serde_json::to_vec(self).map_err(|e| e.to_string())?.len() > 8 * 1024 * 1024 {
            return Err("Graph encoded scene limit exceeded".into());
        }
        Ok(())
    }
}
impl SceneResponse {
    pub fn validate(&self) -> Result<(), String> {
        self.scene.validate()?;
        self.presentation.validate_scene(&self.scene)?;
        let tools: std::collections::BTreeSet<_> = self
            .scene
            .palette()
            .groups
            .iter()
            .flat_map(|g| g.entries.iter().map(|t| t.id.as_str()))
            .collect();
        let mut capabilities = std::collections::BTreeSet::new();
        for capability in &self.capabilities {
            if !tools.contains(capability.tool_id.as_str())
                || !capabilities.insert(capability.tool_id.as_str())
                || (!capability.enabled && capability.reason.is_empty())
            {
                return Err("Invalid tool capability coverage or missing disabled reason".into());
            }
        }
        if tools != capabilities {
            return Err("Missing tool capabilities".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Palette {
    pub schema_version: u32,
    pub id: String,
    pub label: String,
    pub groups: Vec<Group>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Group {
    pub id: String,
    pub label: String,
    pub entries: Vec<Tool>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tool {
    pub id: String,
    pub label: String,
    pub icon: String,
    pub gesture: String,
    pub command: String,
    #[serde(default)]
    pub parameters: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub inputs: Vec<Input>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub default: String,
}
impl Palette {
    /// Structural checks only. Command support/applicability is language-owned.
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != DOCUMENT_VERSION || self.id.is_empty() || self.label.is_empty() {
            return Err("Unsupported palette version or missing identity/label".into());
        }
        if self.groups.len() > 32 {
            return Err("Palette exceeds 32 groups".into());
        }
        let mut ids = std::collections::BTreeSet::new();
        let mut entries = 0;
        for group in &self.groups {
            if group.id.is_empty() || group.label.is_empty() || !ids.insert(&group.id) {
                return Err("Palette group identifiers must be nonempty and unique".into());
            }
            for tool in &group.entries {
                entries += 1;
                if entries > 256
                    || tool.id.is_empty()
                    || tool.command.is_empty()
                    || tool.label.is_empty()
                    || !ids.insert(&tool.id)
                {
                    return Err(
                        "Palette exceeds its entry limit or has missing/duplicate tool identities"
                            .into(),
                    );
                }
                if !["select", "place", "action"].contains(&tool.gesture.as_str()) {
                    return Err(format!("Unsupported palette gesture: {}", tool.gesture));
                }
                let mut inputs = std::collections::BTreeSet::new();
                if tool.inputs.len() > 16
                    || tool
                        .inputs
                        .iter()
                        .any(|i| i.id.is_empty() || i.label.is_empty() || !inputs.insert(&i.id))
                {
                    return Err(
                        "Tool inputs must have unique nonempty identities and labels (maximum 16)"
                            .into(),
                    );
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourcePatch {
    pub uri: String,
    pub range: Range,
    pub original: String,
    pub replacement: String,
    pub before_hash: String,
    pub after_hash: String,
}
impl SourcePatch {
    pub fn validate(&self) -> Result<(), String> {
        identity(&self.uri)?;
        self.range.validate()?;
        for hash in [&self.before_hash, &self.after_hash] {
            if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err("Invalid source buffer SHA-256".into());
            }
        }
        if self.range.start == self.range.end && !self.original.is_empty() {
            return Err("Insertion patch has nonempty original text".into());
        }
        Ok(())
    }
}
impl PreparedEdit {
    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != DOCUMENT_VERSION {
            return Err("Unsupported prepared edit version".into());
        }
        identity(&self.token)?;
        revision(self.base_revision)?;
        revision(self.next_revision)?;
        if self.next_revision <= self.base_revision || self.patches.is_empty() {
            return Err("Prepared edit does not advance a source revision".into());
        }
        for patch in &self.patches {
            patch.validate()?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn palette_rejects_ambiguous_entries_and_unknown_contracts() -> Result<(), String> {
        let mut p = Palette {
            schema_version: 1,
            id: "test".into(),
            label: "Test".into(),
            groups: vec![Group {
                id: "g".into(),
                label: "Group".into(),
                entries: vec![Tool {
                    id: "t".into(),
                    label: "Tool".into(),
                    icon: "box".into(),
                    gesture: "place".into(),
                    command: "a.command".into(),
                    parameters: Default::default(),
                    inputs: vec![],
                }],
            }],
        };
        p.validate()?;
        let duplicate = p.groups[0].entries[0].clone();
        p.groups[0].entries.push(duplicate);
        assert!(p.validate().is_err());
        p.groups[0].entries.pop();
        p.schema_version = 2;
        assert!(p.validate().is_err());
        Ok(())
    }
}

mod rendering;
pub use rendering::*;
