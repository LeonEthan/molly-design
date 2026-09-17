import { Command } from 'commander';
import { runMollyMcpServer } from '@/mcp/molly-mcp-server';
import { runMollyMcpHttpHost } from '@/mcp/molly-mcp-http-host';

export const internalCommand = new Command('__internal')
  .description('(internal) Molly helper commands')
  .addCommand(
    new Command('molly-mcp-server')
      .description('(internal) stdio MCP server for Molly session tools')
      .action(async () => {
        await runMollyMcpServer();
      })
  )
  .addCommand(
    new Command('molly-mcp-http-host')
      .description('(internal) shared HTTP MCP host for Molly session tools')
      .action(async () => {
        await runMollyMcpHttpHost();
      })
  );
