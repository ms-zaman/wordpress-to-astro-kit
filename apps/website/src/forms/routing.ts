// The lead routing layer: where a submission goes, separate from the form UI
// that collects it.
//
// The failure this exists to prevent has two shapes, both found in real
// WordPress sites: a form whose submissions are stored and sent to no one,
// and a form that notifies three individual staff addresses so the lead
// stream degrades silently when one of them leaves. Both are invisible when
// the destination lives inside the form plugin. Here they are rows a check
// can fail on.
//
// A form is UNWIRED until one build variable names its endpoint:
//
//   WPK_FORM_ENDPOINT_CONTACT=https://formspree.io/f/abc pnpm build
//
// The endpoint must accept `multipart/form-data` and answer 2xx. Wired, the
// form posts natively and the transport island upgrades that to an in-page
// submit with explicit outcomes; unwired, it renders the fields and says a
// submission is not sent. Nothing ever reports a success it did not get.
import { processEnvironment } from "../deployment/site-environment.ts";
import { formDefinitions } from "./definitions.ts";

/** The business function that owns a lead stream after delivery. */
export type LeadOwner = "support" | "sales" | "marketing" | "unassigned";

export type LeadTransport =
  | {
      readonly kind: "undecided";
      readonly blockedBy: string;
    }
  | {
      readonly kind: "http-post";
      /** Absolute `https://` URL that accepts the form's fields as form data. */
      readonly endpoint: string;
      /** The build variable that named it. */
      readonly configuredBy: string;
    };

const UNDECIDED: LeadTransport = {
  kind: "undecided",
  blockedBy:
    "no processing endpoint is configured; set the form's WPK_FORM_ENDPOINT_* " +
    "variable at build time",
};

/** What the live site does with this form's submissions today. */
export type LiveDestination =
  | { readonly known: true; readonly value: string; readonly evidence: string }
  | { readonly known: false; readonly reason: string };

export interface LeadRoute {
  readonly formKey: string;
  readonly owner: LeadOwner;
  readonly transport: LeadTransport;
  readonly liveDestination: LiveDestination;
}

/** The build variable that wires one form: `WPK_FORM_ENDPOINT_CONTACT`. */
export function endpointVariable(formKey: string): string {
  return `WPK_FORM_ENDPOINT_${formKey.toUpperCase().replace(/-/g, "_")}`;
}

/**
 * The transport a form has in THIS build: `http-post` when its variable names
 * an `https://` endpoint, `undecided` otherwise. A value that is set but is
 * not an https URL throws — a typo must not quietly leave a form unwired.
 */
export function transportFor(
  formKey: string,
  source: Readonly<Record<string, string | undefined>> = processEnvironment(),
): LeadTransport {
  const variable = endpointVariable(formKey);
  const raw = source[variable]?.trim();
  if (raw === undefined || raw === "") return UNDECIDED;
  if (!/^https:\/\/[^\s"'<>]+$/.test(raw))
    throw new Error(
      `${variable} is "${raw}"; a form endpoint must be an absolute https:// URL`,
    );
  return { kind: "http-post", endpoint: raw, configuredBy: variable };
}

/** Every form's route, one row per form in `definitions.ts`. */
export const LEAD_ROUTES: readonly LeadRoute[] = [
  {
    formKey: "contact",
    owner: "support",
    transport: UNDECIDED,
    liveDestination: {
      known: false,
      reason:
        "Read it from the live site's form plugin — the notification recipient " +
        "and any integration feed (a mailing list, a CRM) — and record it here, " +
        "so the successor delivers to the same place and nobody has to guess.",
    },
  },
];

/** The route for a form, with the transport THIS build resolves for it. */
export function routeFor(
  formKey: string,
  source?: Readonly<Record<string, string | undefined>>,
): LeadRoute | undefined {
  const row = LEAD_ROUTES.find((route) => route.formKey === formKey);
  return row === undefined
    ? undefined
    : { ...row, transport: transportFor(formKey, source) };
}

/** Every form whose lead stream nobody owns yet. */
export function unassignedRoutes(
  routes: readonly LeadRoute[] = LEAD_ROUTES,
): readonly LeadRoute[] {
  return routes.filter((route) => route.owner === "unassigned");
}

/** Every form that would deliver nowhere if it were wired today. */
export function undeliverableRoutes(
  routes: readonly LeadRoute[] = LEAD_ROUTES,
  source?: Readonly<Record<string, string | undefined>>,
): readonly LeadRoute[] {
  return routes.filter(
    (route) => transportFor(route.formKey, source).kind === "undecided",
  );
}

/**
 * Ways this table can be wrong about itself: every form has exactly one row
 * and every row names a form that exists.
 */
export function routingViolations(
  routes: readonly LeadRoute[] = LEAD_ROUTES,
  forms: readonly { readonly key: string }[] = formDefinitions,
): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();

  for (const route of routes) {
    if (seen.has(route.formKey))
      violations.push(`${route.formKey}: routed twice`);
    seen.add(route.formKey);
    if (!forms.some((form) => form.key === route.formKey))
      violations.push(`${route.formKey}: routes a form that does not exist`);
  }
  for (const form of forms)
    if (!seen.has(form.key))
      violations.push(`${form.key}: no route — a form that delivers nowhere`);

  return violations;
}
