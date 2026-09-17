import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import {
  type ChatComposerFileItem,
  type ChatComposerImageItem,
} from '@/components/chat/chat-composer';
import { ChatLandingView } from '@/components/chat/chat-landing-view';
import { registerBuiltInCommands } from '@/lib/commands';

// So the composer's ⌘L focus hint has a command binding to read.
registerBuiltInCommands();

/**
 * These stories render attachments through the REAL production layout
 * components via `ChatLandingView` → `ChatComposer`.
 */
const noop = () => undefined;

const meta = {
  title: 'Chat/Landing Attachments',
  component: ChatLandingView,
  parameters: { layout: 'fullscreen' },
  // Required ChatLandingView props as defaults so the render-only stories below
  // (which build their own trees) still satisfy the typed args contract.
  args: {
    tone: 'light',
    title: "Let's ship something",
    promptValue: '',
    onPromptChange: noop,
  },
} satisfies Meta<typeof ChatLandingView>;

export default meta;
type Story = StoryObj<typeof meta>;

// Inline SVG data-URI thumbnails so image cards render with no fetch mock.
const imagePreviewDataUri = (label: string, color: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="${color}"/><text x="80" y="86" font-family="sans-serif" font-size="20" fill="white" text-anchor="middle">${label}</text></svg>`
  )}`;

const sampleImageItems: ChatComposerImageItem[] = [
  {
    id: 'img-uploaded',
    name: 'mockup.png',
    previewUrl: imagePreviewDataUri('PNG', '#2563eb'),
    status: 'uploaded',
    progress: 100,
  },
  {
    id: 'img-uploading',
    name: 'screenshot.png',
    previewUrl: imagePreviewDataUri('45%', '#7c3aed'),
    status: 'uploading',
    progress: 45,
  },
  {
    id: 'img-failed',
    name: 'too-big.heic',
    previewUrl: imagePreviewDataUri('ERR', '#475569'),
    status: 'failed',
    progress: 0,
    error: 'Upload failed: file exceeds the 5 MB image limit',
  },
];

const sampleFileItems: ChatComposerFileItem[] = [
  {
    id: 'f-epub',
    name: '哥德尔、艾舍尔、巴赫——集异璧之大成.epub',
    sizeLabel: '4.1 MB',
    status: 'uploaded',
    progress: 100,
  },
  { id: 'f-uploaded', name: 'build.log', sizeLabel: '2.3 MB', status: 'uploaded', progress: 100 },
  { id: 'f-uploading', name: 'data.csv', sizeLabel: '11.0 MB', status: 'uploading', progress: 62 },
  {
    id: 'f-failed',
    name: 'archive.zip',
    sizeLabel: '48.0 MB',
    status: 'failed',
    progress: 0,
    error: 'Network error while uploading — tap to retry',
  },
];

/**
 * Desktop landing — the actual `ChatLandingView` (which renders
 * `WebChatLandingScreen` → `ChatComposer`) with attachments populated.
 */
function DesktopLandingDemo() {
  const [prompt, setPrompt] = useState('Review the attached spec and screenshots.');
  return (
    <div className="min-h-screen bg-background">
      <ChatLandingView
        tone="light"
        title="Let's ship something"
        promptValue={prompt}
        onPromptChange={setPrompt}
        promptPlaceholder="Describe the task, attach files or images…"
        onSubmit={noop}
        submitLabel="Send"
        submittingLabel="Sending…"
        imageItems={sampleImageItems}
        onAttachmentAddClick={noop}
        onImageRemove={noop}
        onImageRetry={noop}
        fileItems={sampleFileItems}
        onFileRemove={noop}
        onFileRetry={noop}
      />
    </div>
  );
}

export const DesktopLanding: Story = {
  render: () => <DesktopLandingDemo />,
};
