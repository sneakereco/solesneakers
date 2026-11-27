import { renderToStaticMarkup } from "react-dom/server";

import { ActionButton } from "@/components/ui/ActionButton";
import { RequestError } from "@/components/ui/RequestError";
import { LoadingState, Skeleton } from "@/components/ui/Skeleton";

describe("ActionButton", () => {
  it("keeps native submit and selection semantics with caller styling", () => {
    const html = renderToStaticMarkup(
      <ActionButton className="bg-white" name="intent" value="save" aria-pressed={true}>
        Save
      </ActionButton>,
    );

    expect(html).toContain('name="intent"');
    expect(html).toContain('value="save"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('class="bg-white"');
    expect(html).not.toMatch(/type="button"|aria-busy="true"|disabled=""/);
  });

  it("renders a pending action as a disabled, busy native button", () => {
    const html = renderToStaticMarkup(
      <ActionButton type="submit" pending pendingLabel="Saving changes">
        Save
      </ActionButton>,
    );

    expect(html).toContain('type="submit"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Saving changes");
  });

  it("preserves a caller's native disabled state", () => {
    const html = renderToStaticMarkup(<ActionButton disabled>Save</ActionButton>);

    expect(html).toContain('disabled=""');
    expect(html).not.toContain('aria-busy="true"');
  });
});

describe("LoadingState", () => {
  it("renders skeletons immediately with one empty live region outside the busy subtree", () => {
    const html = renderToStaticMarkup(
      <LoadingState label="Loading sizes" className="grid">
        <Skeleton className="h-6" />
        <Skeleton className="h-8" />
      </LoadingState>,
    );

    expect(Array.from(html.matchAll(/role="status"/g))).toHaveLength(1);
    expect(html).toMatch(
      /<span[^>]+role="status"[^>]*><\/span><div[^>]+aria-busy="true"/,
    );
    expect(html).not.toContain("Loading sizes");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('class="grid"');
    expect(Array.from(html.matchAll(/aria-hidden="true"/g))).toHaveLength(2);
    expect(html).not.toMatch(/tabindex=|<button/);
  });
});

describe("RequestError", () => {
  it("provides a sign-in link and disables retry while the request is pending", () => {
    const html = renderToStaticMarkup(
      <RequestError
        message="Your session expired."
        onRetry={jest.fn()}
        retrying
        signInHref="/login"
      />,
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Your session expired.");
    expect(html).toContain('href="/login"');
    expect(html).toMatch(/<button[^>]+disabled=""/);
  });

  it("renders the error without recovery controls when none are supplied", () => {
    const html = renderToStaticMarkup(<RequestError message="Orders could not load." />);

    expect(html).toContain("Orders could not load.");
    expect(html).not.toMatch(/<button|<a\s/);
  });
});
