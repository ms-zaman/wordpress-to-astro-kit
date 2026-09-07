// The form seam. A form definition is the questions asked and the words
// around them — nothing here submits anything. Where a submission goes is
// `routing.ts`'s decision, and a destination change is a change there.
//
// Read the field list off the live site's own markup, group by group,
// including every `<option>`: an industry list with "and twenty more" in it is
// a list nobody can migrate. The `name` values are yours, not the source's
// (a form plugin's names are widget ids); what has to survive migration is
// the QUESTION, which is `label`.

export interface FormField {
  /** Stable field name. Yours. */
  readonly name: string;
  /** The visible label — the source site's own wording. */
  readonly label: string;
  readonly kind:
    "text" | "email" | "tel" | "select" | "textarea" | "radio" | "file";
  readonly required: boolean;
  readonly placeholder?: string;
  /**
   * Choices for a `select` or a `radio` group, in the source's order. The
   * prompt is rendered as an empty-valued placeholder option, so a required
   * select that was never touched fails constraint validation instead of
   * submitting the prompt as an answer.
   */
  readonly options?: readonly string[];
  /** What a `file` control accepts, as the `accept` attribute. */
  readonly accept?: string;
  /** How much of the form row this control occupies. */
  readonly span?: "half" | "full";
}

export interface FormDefinition {
  readonly key: string;
  /** The accessible name of the form element. */
  readonly name: string;
  readonly fields: readonly FormField[];
  readonly submitLabel: string;
  /** What a reader is told after a WIRED submission succeeds. */
  readonly successMessage: string;
  /**
   * What a reader is told in place of a working submission. Say what the
   * FORM does, never what the build is: this copy ships in production for as
   * long as the form has no endpoint.
   */
  readonly unwiredNotice: string;
  readonly unwiredAction?: { readonly href: string; readonly label: string };
}

const FORMS: readonly FormDefinition[] = [
  {
    key: "contact",
    name: "Contact form",
    submitLabel: "Send message",
    successMessage: "Thanks — your message has been sent.",
    unwiredNotice:
      "This form is not connected to a delivery endpoint yet, so a message " +
      "typed here is not sent. A form that looked like it worked would lose " +
      "the message silently.",
    fields: [
      {
        name: "name",
        label: "Name",
        kind: "text",
        required: true,
        placeholder: "Your name",
        span: "half",
      },
      {
        name: "email",
        label: "Email",
        kind: "email",
        required: true,
        placeholder: "you@example.com",
        span: "half",
      },
      {
        name: "subject",
        label: "Subject",
        kind: "text",
        required: false,
        placeholder: "What is this about?",
        span: "full",
      },
      {
        name: "message",
        label: "Message",
        kind: "textarea",
        required: true,
        placeholder: "Your message",
        span: "full",
      },
    ],
  },
];

const byKey = new Map(FORMS.map((form) => [form.key, form]));

/** Every form the site defines, in declaration order. */
export const formDefinitions: readonly FormDefinition[] = FORMS;

/**
 * The definition for one key. Throws rather than returning `undefined`: a
 * page naming a form nothing defines is a content error, and a build that
 * rendered an empty band for it is a page that looks finished and is wrong.
 */
export function formByKey(key: string): FormDefinition {
  const found = byKey.get(key);
  if (!found)
    throw new Error(
      `No form is defined for key "${key}". Defined keys: ` +
        `${FORMS.map((form) => form.key).join(", ")}.`,
    );
  return found;
}
