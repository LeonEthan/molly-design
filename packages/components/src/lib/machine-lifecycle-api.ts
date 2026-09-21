export type MachineLifecycleAction = 'restart';

export type MintMachineLifecycleRequestTokenResult =
  | { ok: true; requestToken: string; requesterUserId: string }
  | { ok: false; error: string };

/** Hosted lifecycle authorization is outside the local desktop product. */
export async function mintMachineLifecycleRequestToken(_args: {
  workspaceId: string;
  machineId: string;
  action: MachineLifecycleAction;
  requestId: string;
  sessionToken: string;
  authBaseUrl?: string;
}): Promise<MintMachineLifecycleRequestTokenResult> {
  return { ok: false, error: 'Remote Machine lifecycle is unavailable in Molly' };
}
