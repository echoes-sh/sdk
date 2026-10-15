// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { EchoesProvider, RatingWidget, useRating } from "../src/react";
import { Echoes, EchoesError, ErrorCodes } from "../src";
import { mockFetch } from "./helpers";

afterEach(cleanup);

const API_KEY = "ek_test_abc123";
const BASE = "https://echoes.test";
const subject = { type: "room", id: "room-1", version: "2" };
const ok = (updated = false) => ({ status: 201, json: { success: true, ratingId: "r_1", updated } });

function renderWidget(props: Partial<Parameters<typeof RatingWidget>[0]> = {}) {
  const client = new Echoes({ apiKey: API_KEY, baseUrl: BASE });
  return render(
    <EchoesProvider config={client}>
      <RatingWidget subject={subject} {...props} />
    </EchoesProvider>
  );
}

const stars = () => screen.getAllByRole("radio");

describe("RatingWidget", () => {
  it("shows five stars as a labelled radio group, with a dismiss button", () => {
    mockFetch(ok());
    renderWidget();
    const group = screen.getByRole("radiogroup", { name: "How would you rate this?" });
    expect(group).toBeTruthy();
    expect(stars().map((s) => s.getAttribute("aria-label"))).toEqual([
      "1 star",
      "2 stars",
      "3 stars",
      "4 stars",
      "5 stars",
    ]);
    expect(stars().every((s) => s.getAttribute("aria-checked") === "false")).toBe(true);
    // Roving tabindex: one tab stop.
    expect(stars().map((s) => s.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy();
  });

  it("sends 4–5 stars at once and thanks", async () => {
    const { calls } = mockFetch(ok());
    const onRated = vi.fn();
    renderWidget({
      onRated,
      userIdentifier: "household-1",
      metadata: { page: "visit" },
      experiments: [{ key: "room-agent", unitId: "room-1" }],
    });

    fireEvent.click(screen.getByRole("radio", { name: "5 stars" }));

    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Thanks for your rating!");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/api/v1/ratings`);
    expect(calls[0].body).toEqual({
      subject,
      stars: 5,
      userIdentifier: "household-1",
      metadata: { page: "visit" },
      experiments: [{ key: "room-agent", unitId: "room-1" }],
    });
    expect(onRated).toHaveBeenCalledWith({ ratingId: "r_1", updated: false, stars: 5, comment: undefined });
  });

  it("asks for an optional comment for 1–3 stars, then sends both", async () => {
    const { calls } = mockFetch(ok());
    const onRated = vi.fn();
    renderWidget({ onRated });

    fireEvent.click(screen.getByRole("radio", { name: "2 stars" }));
    expect(calls).toHaveLength(0);
    expect(screen.getByRole("radio", { name: "2 stars" }).getAttribute("aria-checked")).toBe("true");
    // The dismiss button goes away once stars are chosen; Skip replaces it.
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();

    const box = screen.getByLabelText("What could be better?");
    fireEvent.change(box, { target: { value: "  The sofa faces the wall  " } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByRole("status");
    expect(calls[0].body).toMatchObject({ stars: 2, comment: "The sofa faces the wall" });
    expect(onRated).toHaveBeenCalledWith(
      expect.objectContaining({ stars: 2, comment: "The sofa faces the wall" })
    );
  });

  it("can skip the comment", async () => {
    const { calls } = mockFetch(ok());
    renderWidget();
    fireEvent.click(screen.getByRole("radio", { name: "3 stars" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await screen.findByRole("status");
    expect(calls[0].body).toMatchObject({ stars: 3 });
    expect(calls[0].body).not.toHaveProperty("comment");
  });

  it("dismisses: sends stars null, calls onDismiss and renders nothing", async () => {
    const { calls } = mockFetch(ok());
    const onDismiss = vi.fn();
    const { container } = renderWidget({ onDismiss });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(container.innerHTML).toBe("");
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toMatchObject({ subject, stars: null });
  });

  it("moves the selection with the arrow keys without sending, and sends on Enter", async () => {
    const { calls } = mockFetch(ok());
    renderWidget();
    const [one] = stars();
    one.focus();

    fireEvent.keyDown(one, { key: "ArrowRight" });
    fireEvent.keyDown(stars()[1], { key: "ArrowRight" });
    fireEvent.keyDown(stars()[2], { key: "ArrowRight" });
    expect(stars().map((s) => s.getAttribute("aria-checked"))).toEqual(["false", "false", "false", "true", "false"]);
    expect(document.activeElement).toBe(stars()[3]);
    expect(stars()[3].tabIndex).toBe(0);

    fireEvent.keyDown(stars()[3], { key: "End" });
    expect(document.activeElement).toBe(stars()[4]);
    fireEvent.keyDown(stars()[4], { key: "ArrowRight" }); // wraps
    expect(document.activeElement).toBe(stars()[0]);
    fireEvent.keyDown(stars()[0], { key: "ArrowLeft" }); // wraps back
    expect(document.activeElement).toBe(stars()[4]);
    expect(calls).toHaveLength(0);

    // A native button's Enter/Space is a click.
    fireEvent.click(stars()[4]);
    await screen.findByRole("status");
    expect(calls[0].body).toMatchObject({ stars: 5 });
  });

  it("takes every string from labels", () => {
    mockFetch(ok());
    renderWidget({
      labels: {
        title: "Qu'en pensez-vous ?",
        star: (n) => `${n} étoile${n > 1 ? "s" : ""}`,
        dismiss: "Fermer",
        commentLabel: "Que pourrait-on améliorer ?",
        submit: "Envoyer",
        skip: "Passer",
      },
    });
    expect(screen.getByRole("radiogroup", { name: "Qu'en pensez-vous ?" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: "1 étoile" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fermer" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "2 étoiles" }));
    expect(screen.getByLabelText("Que pourrait-on améliorer ?")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Envoyer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Passer" })).toBeTruthy();
  });

  it("shows the error and calls onError when sending fails, and lets the person retry", async () => {
    mockFetch({ status: 403, json: { success: false, error: "Origin not allowed" } }, ok());
    const onError = vi.fn();
    renderWidget({ onError });

    fireEvent.click(screen.getByRole("radio", { name: "4 stars" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Origin not allowed");
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: ErrorCodes.ORIGIN_NOT_ALLOWED }));

    fireEvent.click(screen.getByRole("radio", { name: "4 stars" }));
    await screen.findByRole("status");
  });

  it("can hide the dismiss button and applies theme, className and style", () => {
    mockFetch(ok());
    const { container } = renderWidget({ showDismiss: false, theme: "dark", className: "mine", style: { maxWidth: 320 } });
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBe("mine");
    expect(root.style.maxWidth).toBe("320px");
    expect(root.style.backgroundColor).toBe("rgb(31, 41, 55)");
  });
});

describe("useRating", () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <EchoesProvider config={new Echoes({ apiKey: API_KEY, baseUrl: BASE })}>{children}</EchoesProvider>
  );

  it("rates with the hook's defaults and tracks status", async () => {
    const { calls } = mockFetch(ok(true));
    const { result } = renderHook(
      () => useRating(subject, { userIdentifier: "u", metadata: { a: 1 } }),
      { wrapper }
    );
    expect(result.current.status).toBe("idle");

    let answer: unknown;
    await act(async () => {
      answer = await result.current.rate(4, { comment: "ok", metadata: { b: 2 } });
    });
    expect(answer).toEqual({ ratingId: "r_1", updated: true });
    expect(result.current.status).toBe("rated");
    expect(result.current.result).toEqual({ ratingId: "r_1", updated: true });
    expect(calls[0].body).toEqual({
      subject,
      stars: 4,
      comment: "ok",
      userIdentifier: "u",
      metadata: { a: 1, b: 2 },
    });

    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");
  });

  it("dismisses with stars null", async () => {
    const { calls } = mockFetch(ok());
    const { result } = renderHook(() => useRating(subject), { wrapper });
    await act(async () => {
      await result.current.dismiss();
    });
    expect(result.current.status).toBe("dismissed");
    expect(calls[0].body).toMatchObject({ stars: null });
  });

  it("exposes the error and rethrows it", async () => {
    mockFetch({ status: 403, json: { success: false, error: "API key is disabled" } });
    const { result } = renderHook(() => useRating(subject), { wrapper });
    let thrown: unknown;
    await act(async () => {
      thrown = await result.current.rate(5).catch((e) => e);
    });
    expect(thrown).toBeInstanceOf(EchoesError);
    expect(result.current.status).toBe("error");
    expect(result.current.error).toMatchObject({ code: ErrorCodes.INVALID_API_KEY, statusCode: 403 });
  });
});
