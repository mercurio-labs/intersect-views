//! Bind graphical parameters/text through the existing read-only function path.
use super::*;
use intersect_views::{
    ContentSource, GraphicInstance, GraphicRule, GraphicValue, ParameterRule, TextBlock, TextRun,
};
impl Evaluation<'_> {
    pub(super) fn graphic(
        &mut self,
        rule: Option<&GraphicRule>,
        element: ElementId,
        owner: &str,
        slot: &str,
        context: &[String],
    ) -> Result<(Option<GraphicInstance>, BTreeMap<String, TextBlock>), EngineError> {
        let Some(rule) = rule else {
            return Ok((None, BTreeMap::new()));
        };
        let mut parameters = BTreeMap::new();
        for (name, parameter) in &rule.parameters {
            let value = match parameter {
                ParameterRule::Constant { value } => value.clone(),
                ParameterRule::String { value } => {
                    GraphicValue::String(self.scalar(Some(value), element)?)
                }
                ParameterRule::Bool { function } => {
                    self.charge()?;
                    GraphicValue::Bool(self.functions.boolean(function, element)?)
                }
            };
            parameters.insert(name.clone(), value);
        }
        let mut text = BTreeMap::new();
        for (name, block) in &rule.text {
            let key = format!("{slot}.{name}");
            let mut runs = Vec::new();
            for run in &block.runs {
                let parts = crate::labels::Labels {
                    view: &self.view_key,
                    rules: &self.rules.id,
                    model: self.model,
                    functions: self.functions,
                    work: &mut self.counts[4],
                    work_limit: self.limits.function_work,
                    parts: &mut self.part_count,
                    part_limit: 20_000,
                }
                .evaluate_run(
                    &run.label,
                    element,
                    owner,
                    &format!("{key}.{}", run.id),
                    context,
                )?;
                runs.push(TextRun {
                    id: run.id.clone(),
                    parts,
                });
            }
            text.insert(key, TextBlock { runs });
        }
        let slots = rule
            .slots
            .iter()
            .map(|(name, source)| {
                let source = match source {
                    ContentSource::Text { name } => ContentSource::Text {
                        name: format!("{slot}.{name}"),
                    },
                    other => other.clone(),
                };
                (name.clone(), source)
            })
            .collect();
        Ok((
            Some(GraphicInstance {
                definition: rule.definition.clone(),
                source_parameters: None,
                parameters,
                slots,
            }),
            text,
        ))
    }
}
