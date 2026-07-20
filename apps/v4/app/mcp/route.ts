import { createMcpHandler } from "mcp-handler"
import { z } from "zod"

type RegistryItem = {
  name: string
  type?: string
  description?: string
  registryDependencies?: string[]
  dependencies?: string[]
  meta?: unknown
}

function getPublicBaseUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")
  }

  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL

  return vercelHost ? `https://${vercelHost}` : "http://localhost:4000"
}

async function getRegistryIndex() {
  const response = await fetch(`${getPublicBaseUrl()}/r/index.json`, {
    next: { revalidate: 300 },
  })

  if (!response.ok) {
    throw new Error(`Registry index returned HTTP ${response.status}`)
  }

  return (await response.json()) as RegistryItem[]
}

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  }
}

const itemName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9-]*$/)

const styleName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9-]*$/)
  .default("new-york-v4")

const handler = createMcpHandler(
  async (server) => {
    server.registerTool(
      "list_registry_items",
      {
        title: "List registry items",
        description: "List components and other items in this public UI registry.",
        inputSchema: z.object({
          type: z.string().optional(),
          limit: z.number().int().min(1).max(200).default(100),
          offset: z.number().int().min(0).default(0),
        }),
      },
      async ({ type, limit, offset }) => {
        const items = await getRegistryIndex()
        const filtered = type
          ? items.filter((item) => item.type === type)
          : items

        return textResult({
          total: filtered.length,
          offset,
          limit,
          items: filtered.slice(offset, offset + limit).map((item) => ({
            name: item.name,
            type: item.type,
            description: item.description,
          })),
        })
      }
    )

    server.registerTool(
      "search_registry_items",
      {
        title: "Search registry items",
        description: "Search the public UI registry by item name or description.",
        inputSchema: z.object({
          query: z.string().min(1).max(100),
          limit: z.number().int().min(1).max(50).default(20),
        }),
      },
      async ({ query, limit }) => {
        const normalizedQuery = query.toLowerCase()
        const items = (await getRegistryIndex())
          .filter(
            (item) =>
              item.name.toLowerCase().includes(normalizedQuery) ||
              item.description?.toLowerCase().includes(normalizedQuery)
          )
          .slice(0, limit)

        return textResult(items)
      }
    )

    server.registerTool(
      "get_registry_item",
      {
        title: "Get registry item",
        description:
          "Get the complete JSON definition and source files for one registry item.",
        inputSchema: z.object({
          name: itemName,
          style: styleName,
        }),
      },
      async ({ name, style }) => {
        const url = `${getPublicBaseUrl()}/r/styles/${style}/${name}.json`
        const response = await fetch(url, { next: { revalidate: 300 } })

        if (!response.ok) {
          return {
            ...textResult(`Registry item not found: ${name} (${style})`),
            isError: true,
          }
        }

        return textResult({ url, item: await response.json() })
      }
    )

    server.registerTool(
      "get_install_command",
      {
        title: "Get install command",
        description: "Generate the shadcn CLI command for installing registry items.",
        inputSchema: z.object({
          items: z.array(itemName).min(1).max(20),
          style: styleName,
        }),
      },
      async ({ items, style }) => {
        const urls = items.map(
          (name) =>
            `${getPublicBaseUrl()}/r/styles/${style}/${name}.json`
        )

        return textResult(`npx shadcn@latest add ${urls.join(" ")}`)
      }
    )

    server.registerTool(
      "get_registry_info",
      {
        title: "Get registry information",
        description: "Return the public registry and documentation URLs.",
        inputSchema: z.object({}),
      },
      async () =>
        textResult({
          name: "shadcn/ui fork registry",
          registry: `${getPublicBaseUrl()}/r/index.json`,
          itemTemplate: `${getPublicBaseUrl()}/r/styles/new-york-v4/{name}.json`,
          documentation: `${getPublicBaseUrl()}/docs`,
        })
    )
  },
  {},
  {
    basePath: "",
    maxDuration: 60,
    disableSse: true,
  }
)

export { handler as DELETE, handler as GET, handler as POST }
