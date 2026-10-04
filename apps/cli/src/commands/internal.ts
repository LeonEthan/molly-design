import { Command } from 'commander';
import { runMollyMcpServer } from '@/mcp/molly-mcp-server';
import { runMollyImageMcpServer } from '@/mcp/molly-image-mcp-server';
import { runMollyBrowserMcpServer } from '@/mcp/molly-browser-mcp-server';
import { runMollyMcpHttpHost } from '@/mcp/molly-mcp-http-host';
import { runMcpToolDiscovery } from '@/mcp/mcp-tool-discovery';

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
    new Command('molly-image-mcp-server')
      .description('(internal) stdio MCP server for Molly image generation')
      .action(async () => {
        await runMollyImageMcpServer();
      })
  )
  .addCommand(
    new Command('molly-browser-mcp-server')
      .description('(internal) stdio MCP server for the Molly browser page')
      .action(async () => {
        await runMollyBrowserMcpServer();
      })
  )
  .addCommand(
    new Command('mcp-list-tools')
      .description("(internal) list one MCP server's tools for Settings")
      .action(async () => {
        await runMcpToolDiscovery();
      })
  )
  .addCommand(
    new Command('molly-mcp-http-host')
      .description('(internal) shared HTTP MCP host for Molly session tools')
      .action(async () => {
        await runMollyMcpHttpHost();
      })
  );
