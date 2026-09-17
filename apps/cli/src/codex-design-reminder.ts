import { DESIGN_READ_BEFORE_EDIT_REMINDER } from './design/read-before-edit-reminder';

// Public UserPromptSubmit output becomes context before the native model request.
// No file access, read ledger, sync RPC, tool denial or generation state.
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: DESIGN_READ_BEFORE_EDIT_REMINDER,
    },
  })
);
