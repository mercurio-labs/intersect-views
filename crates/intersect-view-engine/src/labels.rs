//! Shared structured-label evaluation for graph and lane scenes.
use crate::{ElementId, EngineError, ViewFunctions, ViewModel, graph::part_id};
use intersect_views::{Label, LabelPart, LabelRule, Slot, Subject};

pub(crate) struct Labels<'a> {
    pub view: &'a str,
    pub rules: &'a str,
    pub model: &'a dyn ViewModel,
    pub functions: &'a dyn ViewFunctions,
    pub work: &'a mut usize,
    pub work_limit: usize,
    pub parts: &'a mut usize,
    pub part_limit: usize,
}
impl Labels<'_> {
    fn charge(&mut self) -> Result<(), EngineError> {
        *self.work = self
            .work
            .checked_add(1)
            .ok_or_else(|| EngineError::limit("function-call work units"))?;
        if *self.work > self.work_limit {
            return Err(EngineError::limit("function-call work units"));
        }
        Ok(())
    }
    fn scalar(
        &mut self,
        slot: &Slot,
        element: ElementId,
        multiline: bool,
    ) -> Result<String, EngineError> {
        match slot {
            Slot::Text { text } => Ok(text.clone()),
            Slot::SourceText { .. } => {
                self.charge()?;
                let text = self.model.source_text(element)?;
                Ok(if multiline {
                    text
                } else {
                    text.replace('\n', " ")
                })
            }
            Slot::Function(name) => {
                self.charge()?;
                self.functions.string(name, element)
            }
        }
    }
    fn parts(
        &mut self,
        rule: Option<&LabelRule>,
        element: ElementId,
        owner: &str,
        slot: &str,
        context: &[String],
        multiline: bool,
    ) -> Result<Label, EngineError> {
        let mut label = Label::default();
        match rule {
            None => {}
            Some(LabelRule::Scalar(s)) => {
                let binding = self.model.binding(element, context)?;
                label.parts.push(LabelPart {
                    id: part_id(
                        self.view,
                        self.rules,
                        owner,
                        slot,
                        "__legacy",
                        Some(&binding.key),
                    )?,
                    text: self.scalar(s, element, multiline)?,
                    binding: Some(binding),
                    edit_tool: None,
                });
            }
            Some(LabelRule::Parts(r)) => {
                for p in &r.parts {
                    if let Some(when) = &p.when {
                        self.charge()?;
                        if !self.functions.boolean(when, element)? {
                            continue;
                        }
                    }
                    let subject = match &p.subject {
                        Subject::This => Some(element),
                        Subject::None => None,
                        Subject::Select { select } => {
                            self.charge()?;
                            let values = self.functions.elements(select, element)?;
                            match values.as_slice() {
                                [] => continue,
                                [id] => Some(*id),
                                _ => {
                                    return Err(EngineError(
                                        "graph.label.subjectCardinality".into(),
                                    ));
                                }
                            }
                        }
                    };
                    let binding = subject
                        .map(|s| self.model.binding(s, context))
                        .transpose()?;
                    let text = match subject {
                        Some(e) => self.scalar(&p.text, e, multiline)?,
                        None => match &p.text {
                            Slot::Text { text } => text.clone(),
                            _ => return Err(EngineError("Unbound function label".into())),
                        },
                    };
                    label.parts.push(LabelPart {
                        id: part_id(
                            self.view,
                            self.rules,
                            owner,
                            slot,
                            &p.id,
                            binding.as_ref().map(|b| b.key.as_str()),
                        )?,
                        text,
                        binding,
                        edit_tool: p.edit.as_ref().map(|e| e.tool.clone()),
                    });
                }
            }
        }
        *self.parts = self
            .parts
            .checked_add(label.parts.len())
            .ok_or_else(|| EngineError::limit("label parts"))?;
        if *self.parts > self.part_limit {
            return Err(EngineError::limit("label parts"));
        }
        Ok(label)
    }
    pub fn evaluate(
        &mut self,
        rule: Option<&LabelRule>,
        element: ElementId,
        owner: &str,
        slot: &str,
        context: &[String],
    ) -> Result<Label, EngineError> {
        let label = self.parts(rule, element, owner, slot, context, false)?;
        label.validate()?;
        Ok(label)
    }
    pub fn evaluate_run(
        &mut self,
        rule: &LabelRule,
        element: ElementId,
        owner: &str,
        slot: &str,
        context: &[String],
    ) -> Result<Vec<LabelPart>, EngineError> {
        let mut label = self.parts(Some(rule), element, owner, slot, context, true)?;
        for part in &mut label.parts {
            part.text = part.text.replace("\r\n", "\n");
        }
        intersect_views::TextBlock {
            runs: vec![intersect_views::TextRun {
                id: "run".into(),
                parts: label.parts.clone(),
            }],
        }
        .validate()?;
        Ok(label.parts)
    }
}
