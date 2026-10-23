import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentsModule } from "@/components/documents/DocumentsModule";
import { FilesModule } from "@/components/files/FilesModule";
import PublicDocumentSigning from "@/pages/PublicDocumentSigning";

const response = (value: unknown) =>
  ({
    json: async () => value,
    ok: true,
  }) as Response;

const emptyFiles = {
  collections: [],
  counts: { active: 0, shared: 0, trash: 0 },
  files: [],
  folders: [],
  settings: {
    defaultView: "grid",
    groupBySource: true,
    retentionDays: 30,
    shareExpiryDays: 7,
  },
  usage: {
    fileCount: 0,
    quotaBytes: 10 * 1024 * 1024 * 1024,
    sources: [],
    usedBytes: 0,
  },
};

const emptyDocuments = {
  counts: { awaiting: 0, completed: 0, total: 0 },
  documents: [],
  settings: {
    defaultSigningOrder: "sequential",
    disclosureText:
      "I consent to use electronic records and signatures for this document.",
    expiryDays: 30,
    identityVerification: false,
    includeWorkspaceBranding: true,
    reminderDays: 3,
  },
  templates: [],
};

const renderModule = (module: ReactNode) => {
  const client = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>{module}</QueryClientProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  localStorage.setItem("access_token", "test-token");
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLElement.prototype.hasPointerCapture = vi.fn();
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Files and Documents modules", () => {
  it("renders the real Files subtabs and clean empty states", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(emptyFiles)));
    renderModule(
      <FilesModule userId="11111111-1111-4111-8111-111111111111" />,
    );

    expect(await screen.findByText("No files here yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Shared with me/i }));
    expect(await screen.findByText("Nothing is shared yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Trash/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Storage/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Settings$/i }));
    expect(await screen.findByText("File preferences")).toBeInTheDocument();
  });

  it("groups submission files by form and keeps the client attached", async () => {
    const file = {
      clientEmail: "ada@example.com",
      clientName: "Ada Client",
      collectionId: "22222222-2222-4222-8222-222222222222",
      collectionName: "Client onboarding",
      collectionType: "form",
      createdAt: "2026-07-29T10:00:00.000Z",
      deletedAt: null,
      folderId: null,
      id: "33333333-3333-4333-8333-333333333333",
      fileKind: "signature",
      mimeType: "image/png",
      name: "identity-photo.png",
      purgeAfter: null,
      scanStatus: "validated",
      shared: false,
      sizeBytes: 2400,
      sourceId: "44444444-4444-4444-8444-444444444444",
      sourceLabel: "Form: Client onboarding",
      sourceType: "form_upload",
      submissionId: "44444444-4444-4444-8444-444444444444",
      tags: [],
      updatedAt: "2026-07-29T10:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({
          ...emptyFiles,
          collections: [
            {
              clients: ["Ada Client"],
              fileCount: 1,
              files: [file],
              id: "form:22222222-2222-4222-8222-222222222222",
              latestAt: "2026-07-29T10:00:00.000Z",
              name: "Client onboarding",
              sizeBytes: 2400,
              sourceId: "22222222-2222-4222-8222-222222222222",
              sourceType: "form",
              submissionCount: 1,
            },
          ],
          counts: { active: 1, shared: 0, trash: 0 },
          files: [file],
        }),
      ),
    );
    renderModule(
      <FilesModule userId="11111111-1111-4111-8111-111111111111" />,
    );

    expect(await screen.findByText("Client onboarding")).toBeInTheDocument();
    expect(screen.getByText("Ada Client")).toBeInTheDocument();
    expect(screen.queryByText("Signature")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Filter by file type"));
    fireEvent.click(await screen.findByRole("option", { name: "Images" }));
    expect(await screen.findByText("No files here yet")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Filter by file type"));
    fireEvent.click(await screen.findByRole("option", { name: "Signatures" }));
    expect(await screen.findByText("Client onboarding")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Select files from Client onboarding",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Download ZIP" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trash" })).toBeInTheDocument();
    fireEvent.click(screen.getByText("Client onboarding"));
    expect(await screen.findByText("identity-photo.png")).toBeInTheDocument();
    expect(screen.getByText("Signature")).toBeInTheDocument();
  });

  it("renders Documents templates, sent documents, and settings subtabs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response(emptyDocuments)));
    renderModule(
      <DocumentsModule userId="11111111-1111-4111-8111-111111111111" />,
    );

    expect(
      await screen.findByText("Create your first template"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Sent documents/i }));
    expect(
      await screen.findByText("No documents have been sent"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Settings$/i }));
    expect(await screen.findByText("Signing defaults")).toBeInTheDocument();
  });

  it("completes a token-scoped public signature without authentication", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("action=sign&")) {
        return response({ completed: true });
      }
      return response({
        completed: false,
        disclosure: "I consent to electronic signatures.",
        document: {
          baseFile: null,
          blocks: [
            { content: "Service agreement", type: "heading" },
            { content: "Please review this agreement.", type: "paragraph" },
          ],
          description: "Agreement details",
          sourceType: "block_built",
          templateName: "Service agreement",
          title: "Service agreement: Acme",
        },
        includeWorkspaceBranding: true,
        signer: {
          email: "signer@example.com",
          name: "Ada Signer",
          role: "signer",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    render(
      <MemoryRouter
        initialEntries={["/sign/test-token"]}
      >
        <QueryClientProvider client={client}>
          <Routes>
            <Route
              path="/sign/:signingToken"
              element={<PublicDocumentSigning />}
            />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(
      await screen.findByText("Service agreement: Acme"),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Ada Signer" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: "Complete signature" }),
    );

    expect(await screen.findByText("Your action is complete")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("action=sign"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});
