import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectsModule } from "@/components/projects/ProjectsModule";
import type { ProjectsTab } from "@/components/projects/project-tabs";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

const jsonResponse = (value: unknown, ok = true) =>
  ({
    json: async () => value,
    ok,
  }) as Response;

const project = {
  access: [
    {
      email: "owner@example.com",
      id: USER_ID,
      name: "Ada Owner",
      role: "owner",
      scoped: false,
      state: "member" as const,
    },
    {
      email: "contractor@example.com",
      id: "33333333-3333-4333-8333-333333333333",
      name: "contractor",
      role: "user",
      scoped: true,
      state: "invited" as const,
    },
  ],
  archivedAt: null,
  color: "violet",
  createdAt: "2026-07-01T10:00:00.000Z",
  description: "Everything for the Acme relaunch",
  eventCount: 1,
  fileCount: 4,
  formCount: 3,
  icon: "rocket",
  id: PROJECT_ID,
  lastActiveAt: "2026-08-04T10:00:00.000Z",
  name: "Acme relaunch",
  status: "active" as const,
  updatedAt: "2026-08-04T10:00:00.000Z",
  workflowCount: 2,
};

const overview = {
  activity: [
    {
      at: "2026-08-04T09:00:00.000Z",
      id: "44444444-4444-4444-8444-444444444444",
      kind: "response" as const,
      subtitle: "New response",
      title: "Client intake",
    },
  ],
  currency: "USD",
  eventCount: 1,
  fileCount: 4,
  formCount: 3,
  registrationsThisMonth: 12,
  responsesThisMonth: 48,
  revenueThisMonth: 1250,
  workflowCount: 2,
};

/** Routes a stubbed fetch by the `action` query parameter the client sends. */
const stubProjectsApi = (
  overrides: Record<string, unknown> = {},
  onRequest?: (action: string, init?: RequestInit) => void,
) => {
  const responses: Record<string, unknown> = {
    access: { members: project.access },
    assignable: { items: [] },
    detail: { project },
    items: { items: [] },
    list: { projects: [project] },
    overview: { overview },
    visibility: {
      projectCount: 2,
      reason: "multiple_projects",
      scopedInvitations: 0,
      visible: true,
    },
    ...overrides,
  };
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const action = new URL(input, "http://localhost").searchParams.get("action") || "";
    onRequest?.(action, init);
    return jsonResponse(responses[action] ?? {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const renderProjects = (
  props: Partial<{
    activeTab: ProjectsTab;
    projectId: string | null;
  }> = {},
) => {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const onOpenProject = vi.fn();
  const onTabChange = vi.fn();
  const view: ReactNode = (
    <ProjectsModule
      activeTab={props.activeTab || "overview"}
      fullName="Ada Owner"
      onOpenProject={onOpenProject}
      onTabChange={onTabChange}
      projectId={props.projectId ?? null}
      userId={USER_ID}
    />
  );
  return {
    ...render(
      <MemoryRouter>
        <QueryClientProvider client={client}>{view}</QueryClientProvider>
      </MemoryRouter>,
    ),
    onOpenProject,
    onTabChange,
  };
};

beforeEach(() => {
  localStorage.setItem("access_token", "test-token");
  localStorage.setItem("maxform.projects.callout-seen", "true");
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn();
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Projects module", () => {
  it("lists projects with their item counts and who has access", async () => {
    stubProjectsApi();
    renderProjects();

    expect(await screen.findByText("Acme relaunch")).toBeInTheDocument();
    expect(screen.getByText("3 forms · 2 workflows · 1 event")).toBeInTheDocument();
    // Owner plus the scoped contractor both appear on the card.
    expect(screen.getByTitle("Ada Owner (owner)")).toBeInTheDocument();
    expect(screen.getByTitle("contractor (user)")).toBeInTheDocument();
  });

  it("shows landing tabs and switches between grid and table views", async () => {
    stubProjectsApi();
    const { onTabChange } = renderProjects();

    expect(await screen.findByRole("navigation", { name: "Projects sections" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All projects" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archived" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Grid view" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Table view" }));
    expect(await screen.findByRole("columnheader", { name: "Project" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Acme relaunch" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Archived" }));
    expect(onTabChange).toHaveBeenCalledWith("archived");
  });

  it("exposes bulk project actions after selecting a project", async () => {
    stubProjectsApi();
    renderProjects();

    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Acme relaunch" }));
    expect(screen.getByText("1 of 1 selected")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: "Project actions" }), {
      key: "Enter",
    });
    expect(await screen.findByRole("menuitem", { name: "Export selected" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Archive selected" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Delete selected" })).toBeInTheDocument();
  });

  it("explains the empty state without pretending a project is required", async () => {
    stubProjectsApi({ list: { projects: [] } });
    renderProjects();

    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
    expect(
      screen.getByText(/Everything stays where it is until you assign it/i),
    ).toBeInTheDocument();
  });

  it("creates a project and opens it", async () => {
    const created = { ...project, id: PROJECT_ID, name: "New client" };
    const seen: Array<{ action: string; body: unknown }> = [];
    stubProjectsApi({ create: { project: created } }, (action, init) => {
      if (init?.body) seen.push({ action, body: JSON.parse(String(init.body)) });
    });
    const { onOpenProject } = renderProjects();

    fireEvent.click(await screen.findByRole("button", { name: /New project/i }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "New client" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create project/i }));

    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith(PROJECT_ID));
    expect(seen[0]).toEqual({
      action: "create",
      body: { color: "blue", description: "", icon: "folder", name: "New client" },
    });
  });

  it("shows scoped stats and activity on a project overview", async () => {
    stubProjectsApi();
    renderProjects({ projectId: PROJECT_ID });

    expect(
      await screen.findByRole("heading", { name: "Acme relaunch" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("48")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("$1,250.00")).toBeInTheDocument();
    expect(screen.getByText("Client intake")).toBeInTheDocument();
  });

  it("keeps delete gated behind typing the exact project name", async () => {
    stubProjectsApi();
    renderProjects({ activeTab: "settings", projectId: PROJECT_ID });

    fireEvent.click(await screen.findByRole("button", { name: /Delete project/i }));
    const confirm = screen.getByRole("button", { name: /^Delete project$/i });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Confirm project name"), {
      target: { value: "Acme relaunch" },
    });
    expect(confirm).toBeEnabled();
  });

  it("promises that deleting the folder unassigns rather than destroys work", async () => {
    stubProjectsApi();
    renderProjects({ activeTab: "settings", projectId: PROJECT_ID });

    expect(
      await screen.findByText(/reappear in the main Forms, Workflows, and Events lists/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Responses, payments, and files are never deleted/i),
    ).toBeInTheDocument();
  });

  it("archives without touching the contents", async () => {
    const seen: string[] = [];
    stubProjectsApi({ archive: { project: { ...project, status: "archived" } } }, (action, init) => {
      if (init?.body) seen.push(action);
    });
    renderProjects({ activeTab: "settings", projectId: PROJECT_ID });

    fireEvent.click(await screen.findByRole("button", { name: /Archive project/i }));
    await waitFor(() => expect(seen).toContain("archive"));
  });

  it("scopes an invitation to the project it was sent from", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    stubProjectsApi({ invite: { members: project.access } }, (action, init) => {
      if (action === "invite" && init?.body) {
        bodies.push(JSON.parse(String(init.body)));
      }
    });
    renderProjects({ activeTab: "team", projectId: PROJECT_ID });

    fireEvent.change(
      await screen.findByPlaceholderText("name@company.com"),
      { target: { value: "new@agency.com" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Invite/i }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      email: "new@agency.com",
      projectId: PROJECT_ID,
      role: "user",
    });
  });

  it("marks a scoped member as limited to this project only", async () => {
    stubProjectsApi();
    renderProjects({ activeTab: "team", projectId: PROJECT_ID });

    // The contractor is limited to this project; the owner is not scoped at
    // all and keeps seeing every project.
    expect(await screen.findByText("This project only")).toBeInTheDocument();
    const memberList = screen
      .getByText(/Who can see Acme relaunch/i)
      .closest("section");
    expect(memberList).not.toBeNull();
    expect(
      within(memberList as HTMLElement).getByText("All projects"),
    ).toBeInTheDocument();
  });
});
