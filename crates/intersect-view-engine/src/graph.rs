//! Structured labels and real region contexts evaluated with the existing adapters.
use super::*;
use intersect_views::{Label, LabelRule, Region, RegionSet};

/// Collect every actual endpoint before visibility, including region descendants.
pub(super) fn subtree_endpoints(node: &Node, ids: &mut BTreeSet<String>) {
    ids.insert(node.id.clone());
    ids.extend(node.ports.iter().map(|port| port.id.clone()));
    for child in node.children.iter().chain(
        node.regions
            .iter()
            .flat_map(|set| &set.items)
            .flat_map(|region| &region.children),
    ) {
        subtree_endpoints(child, ids);
    }
}

/// Visibility is applied only after every bounded occurrence and edge is evaluated.
/// The proxy keeps the original endpoint identity; it never creates a model element.
pub(super) fn hidden_endpoints(nodes: &[Node]) -> BTreeMap<String, intersect_views::EndpointProxy> {
    fn add(
        out: &mut BTreeMap<String, intersect_views::EndpointProxy>,
        id: &str,
        owner: &str,
        binding: &Binding,
        label: &Label,
    ) {
        let mut label = label.clone();
        for part in &mut label.parts {
            part.edit_tool = None;
        }
        out.insert(
            id.into(),
            intersect_views::EndpointProxy {
                id: id.into(),
                display_owner: owner.into(),
                binding: binding.clone(),
                label,
            },
        );
    }
    fn visit(
        nodes: &[Node],
        hidden_by: Option<&str>,
        out: &mut BTreeMap<String, intersect_views::EndpointProxy>,
    ) {
        for node in nodes {
            if let Some(owner) = hidden_by {
                add(out, &node.id, owner, &node.binding, &node.title);
            }
            // A hidden inner collapse cannot displace its nearest visible ancestor.
            let owner = hidden_by.or_else(|| node.collapsed.then_some(node.id.as_str()));
            if let Some(owner) = owner {
                for port in &node.ports {
                    add(out, &port.id, owner, &port.binding, &port.label);
                }
            }
            visit(&node.children, owner, out);
            for region in node.regions.iter().flat_map(|set| &set.items) {
                let region_owner = owner.or_else(|| region.collapsed.then_some(region.id.as_str()));
                visit(&region.children, region_owner, out);
            }
        }
    }
    let mut out = BTreeMap::new();
    visit(nodes, None, &mut out);
    out
}

pub(super) fn apply_collapse(
    nodes: &mut Vec<Node>,
    hidden: &BTreeMap<String, intersect_views::EndpointProxy>,
) {
    nodes.retain(|n| !hidden.contains_key(&n.id));
    for node in nodes {
        node.ports.retain(|p| !hidden.contains_key(&p.id));
        apply_collapse(&mut node.children, hidden);
        if let Some(set) = &mut node.regions {
            if node.collapsed {
                set.items.clear();
            } else {
                for region in &mut set.items {
                    apply_collapse(&mut region.children, hidden);
                }
            }
        }
    }
}

pub(super) fn incident_proxies(
    edges: &[Edge],
    hidden: &BTreeMap<String, intersect_views::EndpointProxy>,
) -> Vec<intersect_views::EndpointProxy> {
    let ids: BTreeSet<_> = edges
        .iter()
        .flat_map(|edge| [&edge.source, &edge.target])
        .collect();
    hidden
        .iter()
        .filter(|(id, _)| ids.contains(id))
        .map(|(_, proxy)| proxy.clone())
        .collect()
}
pub fn part_id(
    view: &str,
    rules: &str,
    owner: &str,
    slot: &str,
    part: &str,
    subject: Option<&str>,
) -> Result<String, EngineError> {
    let tuple = serde_json::json!(["graph-label", view, rules, owner, slot, part, subject]);
    Ok(format!(
        "symbol:{:x}",
        Sha256::digest(serde_json::to_vec(&tuple).map_err(|e| EngineError(e.to_string()))?)
    ))
}
impl Evaluation<'_> {
    pub(super) fn bound_label(
        &mut self,
        rule: Option<&LabelRule>,
        element: ElementId,
        owner: &str,
        slot: &str,
        context: &[String],
    ) -> Result<Label, EngineError> {
        crate::labels::Labels {
            view: &self.view_key,
            rules: &self.rules.id,
            model: self.model,
            functions: self.functions,
            work: &mut self.counts[4],
            work_limit: self.limits.function_work,
            parts: &mut self.part_count,
            part_limit: 20000,
        }
        .evaluate(rule, element, owner, slot, context)
    }

    pub(super) fn regions(
        &mut self,
        rule: Option<&intersect_views::RegionRule>,
        element: ElementId,
        context: &[String],
        depth: usize,
        membership: &mut BTreeSet<ElementId>,
    ) -> Result<Option<RegionSet>, EngineError> {
        let Some(rule) = rule else {
            return Ok(None);
        };
        let mut items = vec![];
        {
            let mut seen = BTreeSet::new();
            for group in self.elements(&rule.select, element)? {
                if !seen.insert(group) {
                    continue;
                }
                if membership.contains(&group) {
                    return Err(EngineError(
                        "graph.region.membership: region is a direct child".into(),
                    ));
                }
                self.region_count += 1;
                if self.region_count > 256 || items.len() >= 16 {
                    return Err(EngineError::limit("regions"));
                }
                if depth + 1 > self.limits.depth {
                    return Err(EngineError::limit("depth"));
                }
                let key = self.model.key(group)?;
                let id = self.symbol(&rule.id, &key, context, "region")?;
                let collapsed = self.collapsed.contains(&(group, context.to_vec()));
                let label =
                    self.bound_label(Some(&rule.label), group, &id, "region.label", context)?;
                let mut children = vec![];
                {
                    let mut child_context = context.to_vec();
                    child_context.push(key);
                    let mut seen = BTreeSet::new();
                    for child in self.elements(&rule.children.select, group)? {
                        if !seen.insert(child) {
                            continue;
                        }
                        if !membership.insert(child) {
                            return Err(EngineError("graph.region.membership".into()));
                        }
                        if let Some(node) = self.node(child, &child_context, depth + 2)? {
                            children.push(node);
                        } else {
                            self.problems.push(format!(
                                "Unmatched region child: {}",
                                self.model.key(child)?
                            ));
                        }
                    }
                }
                items.push(Region {
                    id,
                    rule: rule.id.clone(),
                    label,
                    binding: self.model.binding(group, context)?,
                    collapsed,
                    children,
                });
            }
        }
        Ok(Some(RegionSet {
            direction: rule.direction.clone(),
            items,
        }))
    }
}

impl Evaluation<'_> {
    /// Flatten visual ownership only. Semantic occurrence contexts stay intact.
    pub(super) fn containment_tree(
        &mut self,
        roots: Vec<Node>,
        edges: &mut Vec<Edge>,
        role: &str,
        notation: &str,
    ) -> Result<Vec<Node>, EngineError> {
        fn visit(
            e: &mut Evaluation<'_>,
            mut node: Node,
            out: &mut Vec<Node>,
            edges: &mut Vec<Edge>,
            role: &str,
            notation: &str,
        ) -> Result<(), EngineError> {
            if node.regions.is_some() {
                return Err(EngineError(
                    "Containment tree does not accept region ownership".into(),
                ));
            }
            let children = std::mem::take(&mut node.children);
            let parent = node.id.clone();
            out.push(node);
            for child in children {
                if edges.len() >= e.limits.edges {
                    return Err(EngineError::limit("edges"));
                }
                let tuple = serde_json::json!([
                    "containment-tree",
                    e.view_key,
                    e.rules.id,
                    role,
                    parent,
                    child.id
                ]);
                let id = format!(
                    "symbol:{:x}",
                    Sha256::digest(
                        serde_json::to_vec(&tuple).map_err(|err| EngineError(err.to_string()))?
                    )
                );
                edges.push(Edge {
                    id,
                    rule: role.into(),
                    style_class: String::new(),
                    notation: notation.into(),
                    label: Default::default(),
                    source: parent.clone(),
                    target: child.id.clone(),
                    branch_group: if e.rules.routing.trunks
                        == intersect_views::TrunkPolicy::Siblings
                    {
                        let group = serde_json::json!([
                            "containment-branches",
                            e.view_key,
                            e.rules.id,
                            role,
                            parent
                        ]);
                        Some(format!(
                            "branch:{:x}",
                            Sha256::digest(
                                serde_json::to_vec(&group)
                                    .map_err(|err| EngineError(err.to_string()))?
                            )
                        ))
                    } else {
                        None
                    },
                    binding: child.binding.clone(),
                    start_marker: None,
                    end_marker: None,
                    text: Default::default(),
                });
                visit(e, child, out, edges, role, notation)?;
            }
            Ok(())
        }
        let mut result = Vec::new();
        for root in roots {
            visit(self, root, &mut result, edges, role, notation)?;
        }
        Ok(result)
    }
}
