import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ThemeProvider } from "next-themes";

import About from "./About";
import Contact from "./Contact";
import Landing from "./Landing";

// jsdom has no layout engine, so scroll APIs the marketing shell uses are stubs.
beforeAll(() => {
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  Element.prototype.scrollIntoView = vi.fn();
});

const wrap = (ui: React.ReactNode, route: string) =>
  render(
    <ThemeProvider attribute="class">
      <MemoryRouter
        initialEntries={[route]}
      >
        {ui}
      </MemoryRouter>
    </ThemeProvider>,
  );

describe("marketing pages", () => {
  it("renders Landing with shared chrome", () => {
    wrap(<Landing />, "/");
    expect(screen.getAllByText("MaxForm").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /Start free/i }).length).toBeGreaterThan(0);
    expect(document.querySelector("footer")).toBeTruthy();
  });

  it("renders About", () => {
    wrap(<About />, "/about");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/gluing/i);
    expect(screen.getByText(/Our mission/i)).toBeTruthy();
    // nav marks the current page
    expect(screen.getAllByRole("link", { name: "About" })[0]).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("renders Contact and validates the form", async () => {
    wrap(<Contact />, "/contact");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/trying to build/i);

    // empty submit surfaces field errors, no navigation
    fireEvent.click(screen.getByRole("button", { name: /Send message/i }));
    await waitFor(() => expect(screen.getByText("Tell us who you are.")).toBeTruthy());
    expect(screen.getByText("We need an address to reply to.")).toBeTruthy();

    // bad email is rejected
    fireEvent.change(screen.getByLabelText(/Full name/i), { target: { value: "Ada" } });
    fireEvent.change(screen.getByLabelText(/Work email/i), { target: { value: "nope" } });
    fireEvent.change(screen.getByLabelText(/^Message$/i), {
      target: { value: "I would like to talk about migrating our intake forms." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send message/i }));
    await waitFor(() =>
      expect(screen.getByText("That doesn't look like a valid email.")).toBeTruthy(),
    );

    // valid submit reaches the confirmation state
    fireEvent.change(screen.getByLabelText(/Work email/i), {
      target: { value: "ada@company.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Send message/i }));
    await waitFor(
      () => expect(screen.getByText("Message received.")).toBeTruthy(),
      { timeout: 3000 },
    );
    expect(screen.getByText("ada@company.com")).toBeTruthy();
  });
});
