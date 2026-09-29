import { defineTool, type ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

export const QUESTION_EXTENSION_IDENTITY = { name: 'molly-question', version: '1' };
const fields = {
  question: Type.String({ minLength: 1, maxLength: 8192 }),
  options: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 1024 }), { maxItems: 32 })
  ),
  multiSelect: Type.Optional(Type.Boolean()),
};

export const questionExtension: ExtensionFactory = (pi) => {
  pi.registerTool(
    defineTool({
      name: 'ask_question',
      label: 'Ask Question',
      description:
        'Ask clarifying questions using dialogs. An unanswered question never grants approval.',
      parameters: Type.Object({
        ...fields,
        question: Type.Optional(fields.question),
        questions: Type.Optional(
          Type.Array(
            Type.Object({
              ...fields,
              id: Type.Optional(Type.String({ maxLength: 200 })),
            }),
            { minItems: 1, maxItems: 8 }
          )
        ),
      }),
      executionMode: 'sequential',
      async execute(_id, params, signal, _update, ctx) {
        if (!ctx.hasUI) throw new Error('harness_question_ui_unavailable');
        const items = params.questions ?? [{ ...params, id: 'question_1' }];
        if (items.some((item) => !item.question?.trim()))
          throw new Error('harness_question_required');
        const ids = new Set<string>();
        const questions = items.map((item, index) => {
          const base = item.id?.trim() || `question_${index + 1}`;
          let id = base;
          for (let suffix = 2; ids.has(id); suffix++) id = `${base}_${suffix}`;
          ids.add(id);
          return {
            id,
            question: item.question!.trim(),
            options: [...new Set(item.options ?? [])],
            multiSelect: item.multiSelect === true,
          };
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 300_000);
        const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
        const answers: Array<{ id: string; question: string; answer: string; wasCustom: boolean }> =
          [];
        let unanswered = false;
        try {
          for (const question of questions) {
            const selected: string[] = [];
            const label = (base: string) => {
              let value = base;
              for (let n = 2; question.options.includes(value); n++) value = `${base} (${n})`;
              return value;
            };
            const custom = label('Type a custom answer');
            const done = label('Done selecting');
            for (;;) {
              if (combined.aborted) {
                unanswered = true;
                break;
              }
              const choice = await ctx.ui.select(
                question.question,
                [
                  ...question.options.filter((option) => !selected.includes(option)),
                  custom,
                  ...(question.multiSelect && selected.length ? [done] : []),
                ],
                { signal: combined }
              );
              if (combined.aborted || choice === undefined) {
                unanswered = true;
                break;
              }
              if (choice === done && selected.length) break;
              if (choice !== custom && !question.options.includes(choice))
                throw new Error('harness_question_invalid_answer');
              const value =
                choice === custom
                  ? await ctx.ui.input(question.question, 'Type your answer', { signal: combined })
                  : choice;
              if (combined.aborted || value === undefined) {
                unanswered = true;
                break;
              }
              if (!value.trim()) continue;
              selected.push(value.trim());
              if (!question.multiSelect) break;
            }
            if (unanswered) break;
            answers.push({
              id: question.id,
              question: question.question,
              answer: selected.join(', '),
              wasCustom: selected.some((value) => !question.options.includes(value)),
            });
          }
          const timedOut = unanswered && controller.signal.aborted && !signal?.aborted;
          const cancelled = unanswered && !timedOut;
          return {
            content: [
              {
                type: 'text',
                text: unanswered
                  ? "No answer was provided. Do not infer the user's choice or approval."
                  : answers.map((answer) => `${answer.id}: ${answer.answer}`).join('\n'),
              },
            ],
            details: { questions, answers: unanswered ? [] : answers, cancelled, timedOut },
          };
        } finally {
          clearTimeout(timer);
        }
      },
    })
  );
};
