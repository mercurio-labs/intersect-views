//! Handwritten deterministic graph evaluation. No Rcore, Model or language dependency.
use intersect_views::{
    Binding, Compartment, Edge, EdgeRule, ExpandOption, GraphRuleSet, GraphScene, LayoutHints,
    Node, Palette, Port, Row, SceneLimits, Scope, ScopeOp, Slot, VERSION, View,
};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
pub mod graph;
mod graphics;
pub mod grid;
mod labels;
pub mod lane;
mod lane_order;
pub mod legality;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct ElementId(usize);
impl ElementId {
    pub const fn new(index: usize) -> Self {
        Self(index)
    }
    pub const fn index(self) -> usize {
        self.0
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EngineError(pub String);
impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for EngineError {}
impl From<String> for EngineError {
    fn from(value: String) -> Self {
        Self(value)
    }
}
impl EngineError {
    pub fn limit(name: &str) -> Self {
        Self(format!("Engine limit exceeded: {name}"))
    }
}
pub trait ViewModel {
    fn element(&self, key: &str) -> Option<ElementId>;
    fn key(&self, element: ElementId) -> Result<String, EngineError>;
    fn is_a(&self, element: ElementId, class: &str) -> Result<bool, EngineError>;
    /// Required to rank matching rules without depending on a metamodel library.
    fn class_is_a(&self, class: &str, base: &str) -> Result<bool, EngineError>;
    fn binding(&self, element: ElementId, context: &[String]) -> Result<Binding, EngineError>;
    /// Bounded text of the accepted stored element's exact source span. It does
    /// not parse source, infer semantics, or read external resources.
    fn source_text(&self, _element: ElementId) -> Result<String, EngineError> {
        Err(EngineError(
            "Source text is unavailable for this model adapter".into(),
        ))
    }
}
pub trait ViewFunctions {
    fn elements(&self, name: &str, element: ElementId) -> Result<Vec<ElementId>, EngineError>;
    fn boolean(&self, name: &str, element: ElementId) -> Result<bool, EngineError>;
    fn string(&self, name: &str, element: ElementId) -> Result<String, EngineError>;
}
#[derive(Clone, Copy, Debug)]
pub struct EngineLimits {
    pub nodes: usize,
    pub ports: usize,
    pub edges: usize,
    pub rows: usize,
    pub depth: usize,
    pub function_work: usize,
}
impl Default for EngineLimits {
    fn default() -> Self {
        Self {
            nodes: 500,
            ports: 1000,
            edges: 2000,
            rows: 5000,
            depth: 16,
            function_work: 2_000_000,
        }
    }
}
#[derive(Clone)]
struct Occurrence {
    element: ElementId,
    rule: usize,
    context: Vec<String>,
    id: String,
}
struct Evaluation<'a> {
    rules: &'a GraphRuleSet,
    model: &'a dyn ViewModel,
    functions: &'a dyn ViewFunctions,
    limits: EngineLimits,
    view_key: String,
    counts: [usize; 5],
    part_count: usize,
    region_count: usize,
    endpoints: BTreeMap<(Vec<String>, ElementId), String>,
    occurrences: Vec<Occurrence>,
    problems: Vec<String>,
    collapsed: BTreeSet<(ElementId, Vec<String>)>,
}
impl Evaluation<'_> {
    fn charge(&mut self) -> Result<(), EngineError> {
        self.counts[4] += 1;
        if self.counts[4] > self.limits.function_work {
            Err(EngineError::limit("function-call work units"))
        } else {
            Ok(())
        }
    }
    fn elements(&mut self, name: &str, element: ElementId) -> Result<Vec<ElementId>, EngineError> {
        self.charge()?;
        self.functions.elements(name, element)
    }
    fn scalar(&mut self, slot: Option<&Slot>, element: ElementId) -> Result<String, EngineError> {
        match slot {
            None => Ok(String::new()),
            Some(Slot::Text { text }) => Ok(text.clone()),
            Some(Slot::SourceText { .. }) => {
                self.charge()?;
                self.model.source_text(element)
            }
            Some(Slot::Function(name)) => {
                self.charge()?;
                self.functions.string(name, element)
            }
        }
    }
    fn symbol(
        &self,
        rule: &str,
        key: &str,
        context: &[String],
        role: &str,
    ) -> Result<String, EngineError> {
        let context = serde_json::to_string(context).map_err(|e| EngineError(e.to_string()))?;
        Ok(format!(
            "symbol:{:x}",
            Sha256::digest(format!("{}:{rule}:{key}:{context}:{role}", self.view_key).as_bytes())
        ))
    }
    fn matching(&self, element: ElementId, emit: &str) -> Result<Option<usize>, EngineError> {
        let mut matches = vec![];
        for (index, rule) in self.rules.symbols.iter().enumerate() {
            if rule.emit == emit && self.model.is_a(element, &rule.class)? {
                matches.push(index);
            }
        }
        for &index in &matches {
            let class = &self.rules.symbols[index].class;
            let mut shadowed = false;
            for &other in &matches {
                let candidate = &self.rules.symbols[other].class;
                if self.model.class_is_a(candidate, class)?
                    && !self.model.class_is_a(class, candidate)?
                {
                    shadowed = true;
                    break;
                }
            }
            if !shadowed {
                return Ok(Some(index));
            }
        }
        Ok(None)
    }
    fn node(
        &mut self,
        element: ElementId,
        context: &[String],
        depth: usize,
    ) -> Result<Option<Node>, EngineError> {
        let Some(index) = self.matching(element, "node")? else {
            return Ok(None);
        };
        if depth > self.limits.depth {
            return Err(EngineError::limit("depth"));
        }
        self.counts[0] += 1;
        if self.counts[0] > self.limits.nodes {
            return Err(EngineError::limit("nodes"));
        }
        let rule = self.rules.symbols[index].clone();
        let key = self.model.key(element)?;
        let id = self.symbol(&rule.id, &key, context, "node")?;
        let collapsed = self.collapsed.contains(&(element, context.to_vec()));
        self.endpoints
            .insert((context.to_vec(), element), id.clone());
        self.occurrences.push(Occurrence {
            element,
            rule: index,
            context: context.to_vec(),
            id: id.clone(),
        });
        let mut child_context = context.to_vec();
        child_context.push(key);
        let title = self.bound_label(rule.title.as_ref(), element, &id, "node.title", context)?;
        let subtitle = self.bound_label(
            rule.subtitle.as_ref(),
            element,
            &id,
            "node.subtitle",
            context,
        )?;
        let style_class = self.scalar(rule.style_class.as_ref(), element)?;
        let mut ports = vec![];
        if let Some(select) = &rule.ports {
            let port_rule = self
                .rules
                .symbols
                .iter()
                .find(|r| r.id == select.rule)
                .cloned()
                .ok_or_else(|| EngineError(format!("Unknown port rule {}", select.rule)))?;
            for port in self.elements(&select.select, element)? {
                if !self.model.is_a(port, &port_rule.class)? {
                    return Err(EngineError(format!(
                        "Port selection {} returned an incompatible class",
                        select.select
                    )));
                }
                self.counts[1] += 1;
                if self.counts[1] > self.limits.ports {
                    return Err(EngineError::limit("ports"));
                }
                let port_key = self.model.key(port)?;
                let port_id = self.symbol(&port_rule.id, &port_key, &child_context, "port")?;
                self.endpoints
                    .insert((child_context.clone(), port), port_id.clone());
                let (graphic, text) = self.graphic(
                    port_rule.graphic.as_ref(),
                    port,
                    &port_id,
                    "port.text",
                    &child_context,
                )?;
                ports.push(Port {
                    id: port_id.clone(),
                    rule: port_rule.id.clone(),
                    label: self.bound_label(
                        port_rule.label.as_ref(),
                        port,
                        &port_id,
                        "port.label",
                        &child_context,
                    )?,
                    side: self.scalar(port_rule.side.as_ref(), port)?,
                    binding: self.model.binding(port, &child_context)?,
                    graphic,
                    text,
                });
            }
        }
        let mut compartments = vec![];
        for compartment in &rule.compartments {
            let mut rows = vec![];
            for row in self.elements(&compartment.rows, element)? {
                self.counts[3] += 1;
                if self.counts[3] > self.limits.rows {
                    return Err(EngineError::limit("rows"));
                }
                let row_id = self.symbol(&rule.id, &self.model.key(row)?, &child_context, "row")?;
                rows.push(Row {
                    id: row_id.clone(),
                    label: self.bound_label(
                        Some(&compartment.row_label),
                        row,
                        &row_id,
                        "row.label",
                        &child_context,
                    )?,
                    binding: self.model.binding(row, &child_context)?,
                });
            }
            compartments.push(Compartment {
                id: graph::part_id(
                    &self.view_key,
                    &self.rules.id,
                    &id,
                    "compartment",
                    &compartment.id,
                    None,
                )?,
                label: compartment.label.clone(),
                rows,
            });
        }
        let mut children = vec![];
        let mut membership = BTreeSet::new();
        if let Some(select) = &rule.children {
            for child in self.elements(&select.select, element)? {
                if !membership.insert(child) {
                    continue;
                }
                if let Some(node) = self.node(child, &child_context, depth + 1)? {
                    children.push(node);
                }
            }
        }
        let regions = self.regions(
            rule.regions.as_ref(),
            element,
            &child_context,
            depth,
            &mut membership,
        )?;
        let (graphic, text) =
            self.graphic(rule.graphic.as_ref(), element, &id, "node.text", context)?;
        Ok(Some(Node {
            id,
            rule: rule.id,
            style_class,
            expand: rule
                .expand
                .iter()
                .map(|e| ExpandOption {
                    id: e.id.clone(),
                    label: e.label.clone(),
                })
                .collect(),
            collapsed,
            notation: rule.notation.unwrap_or_default(),
            title,
            subtitle,
            binding: self.model.binding(element, context)?,
            compartments,
            children,
            regions,
            ports,
            graphic,
            text,
        }))
    }
    fn endpoint(
        &self,
        anchor: &[String],
        path: &[ElementId],
    ) -> Result<Option<String>, EngineError> {
        let Some((last, parents)) = path.split_last() else {
            return Ok(None);
        };
        let mut context = anchor.to_vec();
        for parent in parents {
            context.push(self.model.key(*parent)?);
        }
        Ok(self.endpoints.get(&(context, *last)).cloned())
    }
    fn edges(&mut self) -> Result<Vec<Edge>, EngineError> {
        let mut edges = vec![];
        let mut seen = BTreeSet::new();
        let mut references = BTreeSet::new();
        for occurrence in self.occurrences.clone() {
            let owner_key = self.model.key(occurrence.element)?;
            for edge in self.rules.edges.clone() {
                let (per, anchor, root_only) = match &edge {
                    EdgeRule::Element {
                        per,
                        anchor,
                        root_only,
                        ..
                    }
                    | EdgeRule::Reference {
                        per,
                        anchor,
                        root_only,
                        ..
                    } => (per, anchor, root_only),
                };
                if *per != self.rules.symbols[occurrence.rule].id
                    || (*root_only && !occurrence.context.is_empty())
                {
                    continue;
                }
                let mut context = if anchor == "root" {
                    vec![]
                } else {
                    occurrence.context.clone()
                };
                if anchor == "owner" {
                    context.push(owner_key.clone());
                }
                match edge {
                    EdgeRule::Element {
                        id,
                        select,
                        notation,
                        label,
                        source_path,
                        target_path,
                        start_marker,
                        end_marker,
                        ..
                    } => {
                        for element in self.elements(&select, occurrence.element)? {
                            if !seen.insert((element, context.clone())) {
                                continue;
                            }
                            let source_path = self.elements(&source_path, element)?;
                            let target_path = self.elements(&target_path, element)?;
                            let source = self.endpoint(&context, &source_path)?;
                            let target = self.endpoint(&context, &target_path)?;
                            if let (Some(source), Some(target)) = (source, target) {
                                self.add_edge()?;
                                let edge_id =
                                    self.symbol(&id, &self.model.key(element)?, &context, "edge")?;
                                let edge_label = self.bound_label(
                                    Some(&label),
                                    element,
                                    &edge_id,
                                    "edge.label",
                                    &context,
                                )?;
                                let (start, mut text) = self.graphic(
                                    start_marker.as_ref(),
                                    element,
                                    &edge_id,
                                    "edge.start",
                                    &context,
                                )?;
                                let (end, end_text) = self.graphic(
                                    end_marker.as_ref(),
                                    element,
                                    &edge_id,
                                    "edge.end",
                                    &context,
                                )?;
                                text.extend(end_text);
                                edges.push(Edge {
                                    id: edge_id,
                                    rule: id.clone(),
                                    style_class: String::new(),
                                    notation: notation.clone(),
                                    label: edge_label,
                                    source,
                                    target,
                                    branch_group: None,
                                    binding: self.model.binding(element, &context)?,
                                    start_marker: start,
                                    end_marker: end,
                                    text,
                                });
                            } else {
                                self.problems.push(format!(
                                    "Unresolved endpoints for edge {id}: {}",
                                    self.model.key(element)?
                                ));
                            }
                        }
                    }
                    EdgeRule::Reference {
                        id,
                        targets,
                        notation,
                        label,
                        start_marker,
                        end_marker,
                        ..
                    } => {
                        for target in self.elements(&targets, occurrence.element)? {
                            if !references.insert((
                                id.clone(),
                                occurrence.id.clone(),
                                context.clone(),
                                target,
                            )) {
                                continue;
                            }
                            if let Some(target_id) =
                                self.endpoints.get(&(context.clone(), target)).cloned()
                            {
                                self.add_edge()?;
                                // Reference edges have no model element: the ordered source/target
                                // pair supplies their synthetic element identity for the hash.
                                let pair = serde_json::to_string(&(
                                    &owner_key,
                                    &occurrence.context,
                                    self.model.key(target)?,
                                ))
                                .map_err(|e| EngineError(e.to_string()))?;
                                let edge_id = self.symbol(&id, &pair, &context, "edge")?;
                                let edge_label = self.bound_label(
                                    Some(&label),
                                    occurrence.element,
                                    &edge_id,
                                    "edge.label",
                                    &occurrence.context,
                                )?;
                                let (start, mut text) = self.graphic(
                                    start_marker.as_ref(),
                                    occurrence.element,
                                    &edge_id,
                                    "edge.start",
                                    &occurrence.context,
                                )?;
                                let (end, end_text) = self.graphic(
                                    end_marker.as_ref(),
                                    occurrence.element,
                                    &edge_id,
                                    "edge.end",
                                    &occurrence.context,
                                )?;
                                text.extend(end_text);
                                edges.push(Edge {
                                    id: edge_id,
                                    rule: id.clone(),
                                    style_class: String::new(),
                                    notation: notation.clone(),
                                    label: edge_label,
                                    source: occurrence.id.clone(),
                                    target: target_id,
                                    branch_group: None,
                                    start_marker: start,
                                    end_marker: end,
                                    text,
                                    binding: self
                                        .model
                                        .binding(occurrence.element, &occurrence.context)?,
                                });
                            } else {
                                self.problems.push(format!(
                                    "Unresolved target for reference edge {id}: {}",
                                    self.model.key(target)?
                                ));
                            }
                        }
                    }
                }
            }
        }
        Ok(edges)
    }
    fn add_edge(&mut self) -> Result<(), EngineError> {
        self.counts[2] += 1;
        if self.counts[2] > self.limits.edges {
            Err(EngineError::limit("edges"))
        } else {
            Ok(())
        }
    }
}
/// Evaluate graph rules with ordered, client-owned exploration operations.
#[allow(clippy::too_many_arguments)] // Public interface specified in section 6.3.
pub fn evaluate(
    rules: &GraphRuleSet,
    scope: &Scope,
    view: View,
    palette: Palette,
    revision: u64,
    model: &dyn ViewModel,
    functions: &dyn ViewFunctions,
    limits: EngineLimits,
) -> Result<GraphScene, EngineError> {
    rules.validate()?;
    scope.validate()?;
    let mut evaluation = Evaluation {
        rules,
        model,
        functions,
        limits,
        view_key: view.key.clone(),
        counts: [0; 5],
        part_count: 0,
        region_count: 0,
        endpoints: BTreeMap::new(),
        occurrences: vec![],
        problems: vec![],
        collapsed: BTreeSet::new(),
    };
    // Preserve both origins: removeSeed undoes a seed while retaining a root
    // independently introduced by expansion. Hide removes both origins.
    let mut roots: Vec<(ElementId, bool, bool)> = vec![];
    let mut hidden_roots = BTreeSet::new();
    for op in &scope.ops {
        let element = match op {
            ScopeOp::AddSeed { element }
            | ScopeOp::RemoveSeed { element }
            | ScopeOp::Hide { element }
            | ScopeOp::Expand { element, .. }
            | ScopeOp::Collapse { element, .. } => element,
        };
        let Some(id) = model.element(element) else {
            evaluation
                .problems
                .push(format!("Missing scoped element: {element}"));
            continue;
        };
        match op {
            ScopeOp::AddSeed { .. } => {
                if hidden_roots.remove(&id) {
                    roots.retain(|root| root.0 != id);
                }
                add_root(&mut roots, id, true);
            }
            ScopeOp::Hide { .. } => {
                if roots.iter().any(|root| root.0 == id) {
                    hidden_roots.insert(id);
                }
            }
            ScopeOp::RemoveSeed { .. } => {
                for root in &mut roots {
                    if root.0 == id {
                        root.1 = false;
                    }
                }
                roots.retain(|r| r.1 || r.2);
            }
            ScopeOp::Collapse { context, .. } => {
                if let Some(missing) = context.iter().find(|key| model.element(key).is_none()) {
                    evaluation
                        .problems
                        .push(format!("Missing collapse context element: {missing}"));
                } else {
                    evaluation.collapsed.insert((id, context.clone()));
                }
            }
            ScopeOp::Expand { relation, hops, .. } => {
                let mut visited = BTreeSet::from([id]);
                let mut frontier = vec![id];
                for _ in 0..*hops {
                    let mut next = vec![];
                    for owner in frontier {
                        let index = evaluation.matching(owner, "node")?.ok_or_else(|| {
                            EngineError(format!("No node rule for expansion {relation}"))
                        })?;
                        let select = evaluation.rules.symbols[index]
                            .expand
                            .iter()
                            .find(|r| r.id == *relation)
                            .ok_or_else(|| {
                                EngineError(format!("Unknown expand relation {relation}"))
                            })?
                            .select
                            .clone();
                        for target in evaluation.elements(&select, owner)? {
                            if hidden_roots.remove(&target) {
                                roots.retain(|root| root.0 != target);
                            }
                            add_root(&mut roots, target, false);
                            if visited.insert(target) {
                                next.push(target);
                            }
                        }
                    }
                    frontier = next;
                }
            }
        }
    }
    let mut nodes = vec![];
    let mut hidden_ids = BTreeSet::new();
    let mut hidden_root_count = 0;
    for (root, _, _) in roots {
        if let Some(node) = evaluation.node(root, &[], 0)? {
            if hidden_roots.contains(&root) {
                hidden_root_count += 1;
                graph::subtree_endpoints(&node, &mut hidden_ids);
            }
            nodes.push(node);
        } else if matches!(
            rules.projection,
            intersect_views::ProjectionPolicy::ContainmentTree { .. }
        ) {
            return Err(EngineError("Unmatched containment-tree root".into()));
        }
    }
    let hidden = graph::hidden_endpoints(&nodes);
    let mut edges = evaluation.edges()?;
    if let intersect_views::ProjectionPolicy::ContainmentTree {
        edge_role,
        edge_notation,
    } = &rules.projection
    {
        nodes = evaluation.containment_tree(nodes, &mut edges, edge_role, edge_notation)?;
    }
    if hidden_root_count > 0 {
        let before = edges.len();
        edges.retain(|edge| {
            !hidden_ids.contains(&edge.source) && !hidden_ids.contains(&edge.target)
        });
        nodes.retain(|node| !hidden_ids.contains(&node.id));
        evaluation.problems.push(format!(
            "Hidden {hidden_root_count} root(s) and {} incident edge(s)",
            before - edges.len()
        ));
    }
    graph::apply_collapse(&mut nodes, &hidden);
    graph::resolve_automatic_port_sides(&mut nodes, &edges, &rules.layout.direction);
    let endpoint_proxies = graph::incident_proxies(&edges, &hidden);
    let scene = GraphScene {
        schema_version: VERSION,
        form: "graph".into(),
        rule_set: rules.id.clone(),
        revision,
        layout: LayoutHints {
            strategy: rules.layout.strategy.clone(),
            direction: rules.layout.direction.clone(),
        },
        routing: rules.routing.clone(),
        endpoint_proxies,
        view,
        nodes,
        edges,
        palette,
        problems: evaluation.problems,
    };
    scene.validate_with_limits(SceneLimits {
        nodes: limits.nodes,
        ports: limits.ports,
        edges: limits.edges,
        rows: limits.rows,
        depth: limits.depth,
    })?;
    Ok(scene)
}
fn add_root(roots: &mut Vec<(ElementId, bool, bool)>, id: ElementId, seed: bool) {
    if let Some(root) = roots.iter_mut().find(|r| r.0 == id) {
        if seed {
            root.1 = true;
        } else {
            root.2 = true;
        }
    } else {
        roots.push((id, seed, !seed));
    }
}
