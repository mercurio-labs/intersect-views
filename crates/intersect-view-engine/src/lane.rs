//! Flat lane graphs with source-command semantic positions and no host geometry.
use crate::{ElementId, EngineError, ViewFunctions, ViewModel, labels::Labels, lane_order};
use intersect_views::*;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy)]
pub struct LaneLimits {
    pub containers: usize,
    pub lanes: usize,
    pub steps: usize,
    pub spans: usize,
    pub arcs: usize,
    pub work: usize,
    pub parts: usize,
}
impl Default for LaneLimits {
    fn default() -> Self {
        Self {
            containers: 32,
            lanes: 128,
            steps: 500,
            spans: 500,
            arcs: 4000,
            work: 2_000_000,
            parts: 20000,
        }
    }
}
struct Evaluation<'a> {
    rules: &'a LaneGraphRuleSet,
    view: &'a str,
    model: &'a dyn ViewModel,
    functions: &'a dyn ViewFunctions,
    limits: LaneLimits,
    work: usize,
    parts: usize,
}
impl Evaluation<'_> {
    fn charge(&mut self) -> Result<(), EngineError> {
        self.work = self
            .work
            .checked_add(1)
            .ok_or_else(|| EngineError::limit("lane semantic work"))?;
        if self.work > self.limits.work {
            return Err(EngineError::limit("lane semantic work"));
        }
        Ok(())
    }
    fn call(&mut self, name: &str, owner: ElementId) -> Result<Vec<ElementId>, EngineError> {
        self.charge()?;
        self.functions.elements(name, owner)
    }
    fn unique(&mut self, values: Vec<ElementId>) -> Result<Vec<ElementId>, EngineError> {
        let mut seen = BTreeSet::new();
        let mut result = Vec::new();
        for value in values {
            self.charge()?;
            if seen.insert(value) {
                result.push(value);
            }
        }
        Ok(result)
    }
    fn select(&mut self, name: &str, owner: ElementId) -> Result<Vec<ElementId>, EngineError> {
        let values = self.call(name, owner)?;
        self.unique(values)
    }
    fn id(
        &self,
        rule: &str,
        role: &str,
        key: &str,
        container: &str,
    ) -> Result<String, EngineError> {
        crate::grid::symbol(&[
            "lane-graph",
            self.view,
            &self.rules.id,
            rule,
            role,
            key,
            container,
        ])
    }
    fn label(
        &mut self,
        rule: &LabelRule,
        element: ElementId,
        id: &str,
        slot: &str,
        context: &[String],
    ) -> Result<Label, EngineError> {
        Labels {
            view: self.view,
            rules: &self.rules.id,
            model: self.model,
            functions: self.functions,
            work: &mut self.work,
            work_limit: self.limits.work,
            parts: &mut self.parts,
            part_limit: self.limits.parts,
        }
        .evaluate(Some(rule), element, id, slot, context)
    }
}
struct Container {
    key: String,
    lanes: Vec<ElementId>,
    steps: Vec<ElementId>,
}

#[allow(clippy::too_many_arguments)]
pub fn evaluate(
    rules: &LaneGraphRuleSet,
    scope: &Scope,
    view: View,
    palette: Palette,
    revision: u64,
    model: &dyn ViewModel,
    functions: &dyn ViewFunctions,
    limits: LaneLimits,
) -> Result<LaneGraphScene, EngineError> {
    rules.validate()?;
    scope.validate()?;
    let mut seeds = Vec::new();
    let mut problems = Vec::new();
    for op in &scope.ops {
        let (key, add) = match op {
            ScopeOp::AddSeed { element } => (element, true),
            ScopeOp::Hide { element } | ScopeOp::RemoveSeed { element } => (element, false),
            _ => {
                return Err(EngineError(
                    "lane.scope.unsupported: expand/collapse are graph operations".into(),
                ));
            }
        };
        if let Some(element) = model.element(key) {
            if add {
                if !seeds.contains(&element) {
                    seeds.push(element);
                }
            } else {
                seeds.retain(|e| *e != element);
            }
        } else {
            problems.push(format!("Missing scope element: {key}"));
        }
    }
    if seeds.len() > limits.containers {
        return Err(EngineError::limit("lane containers"));
    }
    let r = &rules.lane_graph;
    let mut e = Evaluation {
        rules,
        view: &view.key,
        model,
        functions,
        limits,
        work: 0,
        parts: 0,
    };
    let mut containers = Vec::new();
    let mut memberships = BTreeSet::new();
    let mut keys = BTreeSet::new();
    let mut lane_count = 0;
    let mut step_count = 0;
    for seed in seeds {
        if !model.is_a(seed, &r.container.class)? {
            return Err(EngineError(
                "Lane scope seed does not match its container class".into(),
            ));
        }
        let key = model.key(seed)?;
        let lanes = e.select(&r.container.lanes, seed)?;
        let steps = e.select(&r.container.steps, seed)?;
        lane_count += lanes.len();
        step_count += steps.len();
        if lane_count > limits.lanes {
            return Err(EngineError::limit("lane lanes"));
        }
        if step_count > limits.steps {
            return Err(EngineError::limit("lane steps"));
        }
        for member in lanes.iter().chain(&steps) {
            if !memberships.insert(*member) || !keys.insert(model.key(*member)?) {
                return Err(EngineError(
                    "Lane/step belongs to multiple visible containers or roles".into(),
                ));
            }
        }
        containers.push(Container { key, lanes, steps });
    }
    let mut lanes = Vec::new();
    let mut steps = Vec::new();
    let mut lane_indices = BTreeMap::new();
    let mut step_indices = BTreeMap::new();
    let mut subjects = Vec::new();
    for container in &containers {
        let context = vec![container.key.clone()];
        for &subject in &container.lanes {
            let key = model.key(subject)?;
            let id = e.id(&r.lane.id, "lane", &key, &container.key)?;
            lane_indices.insert(subject, lanes.len());
            lanes.push(Lane {
                label: e.label(&r.lane.label, subject, &id, "lane.label", &context)?,
                id,
                rule: r.lane.id.clone(),
                binding: model.binding(subject, &context)?,
                container: container.key.clone(),
            });
        }
        for &subject in &container.steps {
            let key = model.key(subject)?;
            let id = e.id(&r.step.id, "step", &key, &container.key)?;
            step_indices.insert(subject, steps.len());
            subjects.push(subject);
            steps.push(LaneStep {
                label: e.label(&r.step.label, subject, &id, "step.label", &context)?,
                id,
                rule: r.step.id.clone(),
                binding: model.binding(subject, &context)?,
                lane: String::new(),
                rank: 0,
                unordered: false,
                predecessors: Vec::new(),
            });
        }
    }
    let mut predecessors = Vec::new();
    let mut span_targets = Vec::new();
    let mut arcs = 0;
    for (index, subject) in subjects.into_iter().enumerate() {
        let selected = e.call(&r.step.lane, subject)?;
        let [lane_subject] = selected.as_slice() else {
            return Err(EngineError(
                "Lane step selector must return exactly one lane".into(),
            ));
        };
        let lane = *lane_indices
            .get(lane_subject)
            .ok_or_else(|| EngineError("Step lane is not visible".into()))?;
        if lanes[lane].binding.context != steps[index].binding.context {
            return Err(EngineError("Step lane belongs to another container".into()));
        }
        steps[index].lane = lanes[lane].id.clone();
        let mut parents = Vec::new();
        for parent in e.select(&r.step.after, subject)? {
            let parent = *step_indices
                .get(&parent)
                .ok_or_else(|| EngineError("Lane predecessor is not visible".into()))?;
            if steps[parent].binding.context != steps[index].binding.context {
                return Err(EngineError(
                    "Lane predecessor belongs to another container".into(),
                ));
            }
            parents.push(parent);
        }
        arcs += parents.len();
        if arcs > limits.arcs {
            return Err(EngineError::limit("lane arcs"));
        }
        predecessors.push(parents);
        let end = match e.call(&r.step.end, subject)?.as_slice() {
            [] => None,
            [target] => Some(
                *step_indices
                    .get(target)
                    .ok_or_else(|| EngineError("Lane span end is not visible".into()))?,
            ),
            _ => {
                return Err(EngineError(
                    "Lane span end selector must return zero or one step".into(),
                ));
            }
        };
        let mut coverage = vec![lane];
        for across in e.select(&r.step.across, subject)? {
            let across = *lane_indices
                .get(&across)
                .ok_or_else(|| EngineError("Lane span band is not visible".into()))?;
            if lanes[across].binding.context != steps[index].binding.context {
                return Err(EngineError(
                    "Lane span band belongs to another container".into(),
                ));
            }
            if !coverage.contains(&across) {
                coverage.push(across);
            }
        }
        if let Some(end) = end {
            if steps[end].binding.context != steps[index].binding.context {
                return Err(EngineError(
                    "Lane span end belongs to another container".into(),
                ));
            }
            span_targets.push((index, end, coverage));
            if span_targets.len() > limits.spans {
                return Err(EngineError::limit("lane spans"));
            }
        }
    }
    let order = lane_order::order(&predecessors, limits.steps, limits.arcs)?;
    for (index, step) in steps.iter_mut().enumerate() {
        step.rank = order.ranks[index];
        step.unordered = order.unordered[index];
    }
    for (index, parents) in predecessors.iter().enumerate() {
        steps[index].predecessors = parents.iter().map(|&p| steps[p].id.clone()).collect();
    }
    let mut spans = Vec::new();
    for (start, end, coverage) in span_targets {
        let coverage =
            lane_order::span(steps[start].rank, steps[end].rank, &coverage, lanes.len())?;
        let container = steps[start]
            .binding
            .context
            .first()
            .ok_or_else(|| EngineError("Missing lane container context".into()))?;
        spans.push(LaneSpan {
            id: e.id(&r.step.id, "span", &steps[start].binding.key, container)?,
            step: steps[start].id.clone(),
            end: steps[end].id.clone(),
            lanes: coverage.into_iter().map(|i| lanes[i].id.clone()).collect(),
        });
    }
    let order = order
        .steps
        .into_iter()
        .map(|i| steps[i].id.clone())
        .collect();
    let scene = LaneGraphScene {
        schema_version: VERSION,
        form: "laneGraph".into(),
        rule_set: rules.id.clone(),
        revision,
        view,
        palette,
        problems,
        axis: r.axis.clone(),
        lanes,
        steps,
        spans,
        order,
    };
    scene.validate()?;
    Ok(scene)
}
