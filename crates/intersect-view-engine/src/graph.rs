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

/// The value a port's `side` slot returns when the language has no inherent
/// face for it. No scene carries it: evaluation replaces it below.
const AUTOMATIC_SIDE: &str = "AUTO";

/// Give every automatic port the face its connections cross. Flow that enters
/// the port's owner arrives on the face toward the layout origin; flow that
/// leaves it departs from the opposite face. A link to something nested inside
/// the owner crosses its outline the other way than a link to something outside.
/// A string graphic parameter of the port that also evaluated to the automatic
/// value receives the chosen face, so a glyph can point the way the port faces.
/// Authored sides are never changed, and the result depends only on the scene.
pub(super) fn resolve_automatic_port_sides(nodes: &mut [Node], edges: &[Edge], direction: &str) {
    fn index(
        nodes: &[Node],
        above: Option<&str>,
        owner: &mut BTreeMap<String, String>,
        parent: &mut BTreeMap<String, String>,
        automatic: &mut bool,
    ) {
        for node in nodes {
            owner.insert(node.id.clone(), node.id.clone());
            if let Some(above) = above {
                parent.insert(node.id.clone(), above.to_owned());
            }
            for port in &node.ports {
                owner.insert(port.id.clone(), node.id.clone());
                *automatic |= port.side == AUTOMATIC_SIDE;
            }
            index(&node.children, Some(&node.id), owner, parent, automatic);
            for region in node.regions.iter().flat_map(|r| &r.items) {
                index(&region.children, Some(&node.id), owner, parent, automatic);
            }
        }
    }
    fn assign(nodes: &mut [Node], inward: &BTreeMap<&str, i64>, enter: &str, leave: &str) {
        for node in nodes {
            for port in &mut node.ports {
                if port.side != AUTOMATIC_SIDE {
                    continue;
                }
                let face = if inward.get(port.id.as_str()).copied().unwrap_or(0) > 0 {
                    enter
                } else {
                    leave
                };
                port.side = face.to_owned();
                for value in port
                    .graphic
                    .iter_mut()
                    .flat_map(|g| g.parameters.values_mut())
                {
                    if matches!(value, intersect_views::GraphicValue::String(v) if v == AUTOMATIC_SIDE)
                    {
                        *value = intersect_views::GraphicValue::String(face.to_owned());
                    }
                }
            }
            assign(&mut node.children, inward, enter, leave);
            for region in node.regions.iter_mut().flat_map(|r| &mut r.items) {
                assign(&mut region.children, inward, enter, leave);
            }
        }
    }
    let (mut owner, mut parent, mut automatic) = (BTreeMap::new(), BTreeMap::new(), false);
    index(nodes, None, &mut owner, &mut parent, &mut automatic);
    if !automatic {
        return;
    }
    let within = |node: Option<&String>, ancestor: &String| {
        let mut at = node.and_then(|id| parent.get(id));
        while let Some(id) = at {
            if id == ancestor {
                return true;
            }
            at = parent.get(id);
        }
        false
    };
    // Positive: more links carry flow into the owner through this endpoint.
    let mut inward: BTreeMap<&str, i64> = BTreeMap::new();
    for edge in edges {
        let (source, target) = (owner.get(&edge.source), owner.get(&edge.target));
        if let Some(source) = source {
            *inward.entry(edge.source.as_str()).or_default() +=
                if within(target, source) { 1 } else { -1 };
        }
        if let Some(target) = target {
            *inward.entry(edge.target.as_str()).or_default() +=
                if within(source, target) { -1 } else { 1 };
        }
    }
    let (enter, leave) = match direction {
        "LEFT" => ("EAST", "WEST"),
        "DOWN" => ("NORTH", "SOUTH"),
        "UP" => ("SOUTH", "NORTH"),
        _ => ("WEST", "EAST"),
    };
    assign(nodes, &inward, enter, leave);
}

#[cfg(test)]
mod automatic_port_sides {
    use super::*;
    use intersect_views::{GraphicInstance, GraphicValue};

    /// Real nodes, ports and an edge from the checked scene fixture, reshaped
    /// into: battery.supply -> board.source, board.out -> motor.power (motor is
    /// nested in propulsion), propulsion.power -> motor.power.
    fn fixture() -> (Vec<Node>, Vec<Edge>) {
        let scene: serde_json::Value = serde_json::from_str(include_str!(
            "../../intersect-views/tests/fixtures/scene-v6-m14.json"
        ))
        .unwrap();
        let scene = scene.get("scene").unwrap_or(&scene);
        let node: Node = serde_json::from_value(scene["nodes"][0].clone()).unwrap();
        let port = scene["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|n| n["ports"].as_array().unwrap())
            .next()
            .map(|p| serde_json::from_value::<Port>(p.clone()).unwrap())
            .unwrap();
        let edge: Edge = serde_json::from_value(scene["edges"][0].clone()).unwrap();
        let make_port = |id: &str, side: &str| Port {
            id: id.into(),
            side: side.into(),
            graphic: Some(GraphicInstance {
                definition: "test/port".into(),
                source_parameters: None,
                parameters: BTreeMap::from([
                    ("facing".to_owned(), GraphicValue::String(side.into())),
                    ("angle".to_owned(), GraphicValue::Number(0.0)),
                ]),
                slots: BTreeMap::new(),
            }),
            ..port.clone()
        };
        let make_node = |id: &str, ports: Vec<Port>, children: Vec<Node>| Node {
            id: id.into(),
            ports,
            children,
            regions: None,
            ..node.clone()
        };
        let make_edge = |id: &str, source: &str, target: &str| Edge {
            id: id.into(),
            source: source.into(),
            target: target.into(),
            ..edge.clone()
        };
        let motor = make_node("motor", vec![make_port("motor.power", "AUTO")], vec![]);
        (
            vec![
                make_node("battery", vec![make_port("battery.supply", "AUTO")], vec![]),
                make_node(
                    "board",
                    vec![
                        make_port("board.source", "AUTO"),
                        make_port("board.out", "AUTO"),
                        make_port("board.spare", "AUTO"),
                        make_port("board.pinned", "NORTH"),
                    ],
                    vec![],
                ),
                make_node(
                    "propulsion",
                    vec![make_port("propulsion.power", "AUTO")],
                    vec![motor],
                ),
            ],
            vec![
                make_edge("feed", "battery.supply", "board.source"),
                make_edge("drive", "board.out", "propulsion.power"),
                make_edge("delegate", "propulsion.power", "motor.power"),
            ],
        )
    }
    fn faces(nodes: &[Node], out: &mut BTreeMap<String, (String, String)>) {
        for node in nodes {
            for port in &node.ports {
                let facing = match &port.graphic.as_ref().unwrap().parameters["facing"] {
                    GraphicValue::String(value) => value.clone(),
                    _ => unreachable!(),
                };
                out.insert(port.id.clone(), (port.side.clone(), facing));
            }
            faces(&node.children, out);
        }
    }

    #[test]
    fn ports_face_the_way_their_connections_cross_the_owner() {
        let (mut nodes, edges) = fixture();
        resolve_automatic_port_sides(&mut nodes, &edges, "RIGHT");
        let mut actual = BTreeMap::new();
        faces(&nodes, &mut actual);
        let expect = |side: &str| (side.to_owned(), side.to_owned());
        assert_eq!(actual["battery.supply"], expect("EAST"));
        assert_eq!(actual["board.source"], expect("WEST"));
        assert_eq!(actual["board.out"], expect("EAST"));
        assert_eq!(
            actual["board.spare"],
            expect("EAST"),
            "an unconnected port leaves"
        );
        assert_eq!(
            actual["board.pinned"],
            expect("NORTH"),
            "an authored side is kept"
        );
        // The container's port receives from outside and delegates inward: both
        // links carry flow into propulsion, and into the nested motor.
        assert_eq!(actual["propulsion.power"], expect("WEST"));
        assert_eq!(actual["motor.power"], expect("WEST"));
    }

    #[test]
    fn faces_follow_the_layout_direction_and_never_leave_the_token() {
        for (direction, enter, leave) in [("DOWN", "NORTH", "SOUTH"), ("LEFT", "EAST", "WEST")] {
            let (mut nodes, edges) = fixture();
            resolve_automatic_port_sides(&mut nodes, &edges, direction);
            let mut actual = BTreeMap::new();
            faces(&nodes, &mut actual);
            assert_eq!(actual["board.source"].0, enter);
            assert_eq!(actual["battery.supply"].0, leave);
            assert!(
                actual
                    .values()
                    .all(|(side, facing)| side != "AUTO" && facing != "AUTO")
            );
        }
    }
}
