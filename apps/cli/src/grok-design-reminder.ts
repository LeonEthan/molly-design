import { DESIGN_READ_BEFORE_EDIT_REMINDER } from './design/read-before-edit-reminder';

// Native PreToolUse context reaches the next model request after this tool.
// It does not delay the already-generated call until a read or authorize a commit.
process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: DESIGN_READ_BEFORE_EDIT_REMINDER,
    },
  })
);
