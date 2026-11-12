import { useEffect, useRef } from "react";
import { SignUp } from "@clerk/react";

export function passwordSuggestions(value: string) {
  return [
    Array.from(value).length >= 15,
    /\p{Lu}/u.test(value),
    /\p{N}/u.test(value),
    /[^\p{L}\p{N}\s]/u.test(value),
  ];
}

const suggestions = ["15 or more characters", "An uppercase letter", "A number", "A symbol"];
const emailHintId = "edcurie-signup-email-hint";
const passwordHintId = "edcurie-signup-password-hint";

function describe(input: HTMLInputElement, id: string) {
  const ids = (input.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
  if (!ids.includes(id)) input.setAttribute("aria-describedby", [...ids, id].join(" "));
}

// Clerk owns the form and may re-render it between steps. Attach guidance only
// to the matching sign-up fields; never intercept submission or store passwords.
export default function SignupFieldHints({ path, signInUrl, redirectUrl }: { path: string; signInUrl: string; redirectUrl: string }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    let observing = true;
    const update = (input: HTMLInputElement) => {
      const list = root.querySelector<HTMLElement>(`#${passwordHintId}`);
      if (!list) return;
      const checks = passwordSuggestions(input.value);
      list.querySelectorAll<HTMLElement>("[data-suggestion]").forEach((item, index) => {
        const met = checks[index];
        item.classList.toggle("met", met);
        item.setAttribute("aria-label", `${suggestions[index]}: ${met ? "met" : "not met"}`);
        const icon = item.querySelector<HTMLElement>(".signup-rule-icon");
        if (icon && icon.textContent !== (met ? "✓" : "×")) icon.textContent = met ? "✓" : "×";
      });
    };
    const sync = () => {
      if (!observing) return;
      const email = root.querySelector<HTMLInputElement>('input[name="emailAddress"]');
      const emailField = email?.closest(".cl-formField");
      if (email && emailField) {
        if (!emailField.querySelector(`#${emailHintId}`)) {
          const hint = document.createElement("p");
          hint.id = emailHintId; hint.className = "signup-email-hint";
          hint.textContent = "Example: name@example.com";
          (email.closest(".cl-formFieldInputGroup") || email).insertAdjacentElement("afterend", hint);
        }
        describe(email, emailHintId);
      }
      const password = root.querySelector<HTMLInputElement>('input[name="password"]');
      const passwordField = password?.closest(".cl-formField");
      if (password && passwordField) {
        if (!passwordField.querySelector(`#${passwordHintId}`)) {
          const list = document.createElement("div");
          list.id = passwordHintId; list.className = "signup-password-hints";
          const title = document.createElement("p");
          title.className = "signup-hints-title"; title.textContent = "Password suggestions";
          list.append(title);
          const rules = document.createElement("ul");
          for (const suggestion of suggestions) {
            const item = document.createElement("li"); item.dataset.suggestion = "";
            const icon = document.createElement("span"); icon.className = "signup-rule-icon"; icon.setAttribute("aria-hidden", "true"); icon.textContent = "×";
            const text = document.createElement("span"); text.textContent = suggestion;
            item.append(icon, text); rules.append(item);
          }
          list.append(rules);
          (password.closest(".cl-formFieldInputGroup") || password).insertAdjacentElement("afterend", list);
        }
        describe(password, passwordHintId);
        update(password);
      }
    };
    const onInput = (event: Event) => {
      const input = event.target;
      if (input instanceof HTMLInputElement && input.name === "password") update(input);
    };
    const observer = new MutationObserver(sync);
    observer.observe(root, { childList: true, subtree: true });
    root.addEventListener("input", onInput);
    sync();
    return () => {
      observing = false; observer.disconnect(); root.removeEventListener("input", onInput);
      root.querySelector(`#${emailHintId}`)?.remove();
      root.querySelector(`#${passwordHintId}`)?.remove();
    };
  }, []);
  return <div ref={container}><SignUp routing="path" path={path} signInUrl={signInUrl} forceRedirectUrl={redirectUrl} /></div>;
}
