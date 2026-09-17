import { DESIGN_READ_BEFORE_EDIT_REMINDER } from './design/read-before-edit-reminder';

// Public UserPromptSubmit response. No tool arguments, transcript, or RPC ledger.
const chunks: Buffer[] = [];
let size = 0;
for await (const chunk of process.stdin) {
  size += Buffer.byteLength(chunk);
  if (size > 2 * 1024 * 1024) throw Error('Claude hook input exceeds limit');
  chunks.push(Buffer.from(chunk));
}
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
if (input.hook_event_name === 'UserPromptSubmit') {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: DESIGN_READ_BEFORE_EDIT_REMINDER,
      },
    })
  );
} else process.stdout.write('{}');
