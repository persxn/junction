import { Building2, Compass, Mail, ShieldCheck } from 'lucide-react';

import { Field } from '../Field.js';
import type { FieldErrors, WizardField, WizardValues } from '../wizard-state.js';

/**
 * The four steps that are only questions: the institution, the campus, the
 * first administrator and the contact address. They share a signature so the
 * wizard can render any of them without knowing which it is.
 */

export interface StepProps {
  readonly values: WizardValues;
  readonly errors: FieldErrors;
  readonly onChange: (field: WizardField, value: string) => void;
}

/** A short explanatory panel, for the sentence a field label cannot carry. */
export function Note({
  icon: Icon,
  children,
}: {
  readonly icon: typeof Mail;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <p className="flex gap-2.5 rounded-md border border-line bg-surface-raised p-3 text-sm text-fg-muted">
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
      <span>{children}</span>
    </p>
  );
}

export function OrganizationStep({ values, errors, onChange }: StepProps): React.JSX.Element {
  return (
    <>
      <Field
        label="Institution"
        value={values.organizationName}
        error={errors.organizationName}
        onChange={(value) => {
          onChange('organizationName', value);
        }}
        placeholder="Example Institute of Technology"
        autoFocus
      />
      <Field
        label="Short name (optional)"
        value={values.organizationShortName}
        error={errors.organizationShortName}
        onChange={(value) => {
          onChange('organizationShortName', value);
        }}
        hint="Used where there is no room for the full name."
        placeholder="EIT"
      />
      <Field
        label="Department"
        value={values.departmentName}
        error={errors.departmentName}
        onChange={(value) => {
          onChange('departmentName', value);
        }}
        placeholder="Computer Science and Engineering"
      />
      <Field
        label="Department code (optional)"
        value={values.departmentCode}
        error={errors.departmentCode}
        onChange={(value) => {
          onChange('departmentCode', value);
        }}
        placeholder="CSE"
      />
      <Note icon={Building2}>
        This is the department CompIntel belongs to. Students from other departments can still join
        teams — you will add those departments as you go.
      </Note>
    </>
  );
}

export function CampusStep({ values, errors, onChange }: StepProps): React.JSX.Element {
  return (
    <>
      <Field
        label="Campus name"
        value={values.campusName}
        error={errors.campusName}
        onChange={(value) => {
          onChange('campusName', value);
        }}
        placeholder="Main Campus"
        autoFocus
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Latitude"
          type="text"
          value={values.campusLat}
          error={errors.campusLat}
          onChange={(value) => {
            onChange('campusLat', value);
          }}
          placeholder="10.7594"
        />
        <Field
          label="Longitude"
          type="text"
          value={values.campusLon}
          error={errors.campusLon}
          onChange={(value) => {
            onChange('campusLon', value);
          }}
          placeholder="78.8149"
        />
      </div>
      <Note icon={Compass}>
        Distances are measured from here, so &quot;events near us&quot; means near this point.
        Right-click your campus in Google Maps and the first line of the menu is the pair of numbers
        to paste.
      </Note>
    </>
  );
}

export function AdministratorStep({ values, errors, onChange }: StepProps): React.JSX.Element {
  return (
    <>
      <Field
        label="Your name"
        value={values.adminDisplayName}
        error={errors.adminDisplayName}
        onChange={(value) => {
          onChange('adminDisplayName', value);
        }}
        autoComplete="name"
        placeholder="A. Professor"
        autoFocus
      />
      <Field
        label="E-mail"
        type="email"
        value={values.adminEmail}
        error={errors.adminEmail}
        onChange={(value) => {
          onChange('adminEmail', value);
        }}
        autoComplete="username"
        hint="This is what you sign in with."
        placeholder="you@example.edu"
      />
      <Field
        label="Password"
        type="password"
        value={values.adminPassword}
        error={errors.adminPassword}
        onChange={(value) => {
          onChange('adminPassword', value);
        }}
        autoComplete="new-password"
        hint="At least 12 characters. A short sentence works well."
      />
      <Field
        label="Password again"
        type="password"
        value={values.adminPasswordConfirm}
        error={errors.adminPasswordConfirm}
        onChange={(value) => {
          onChange('adminPasswordConfirm', value);
        }}
        autoComplete="new-password"
      />
      <Note icon={ShieldCheck}>
        This account can do everything, including managing other people&apos;s accounts. You can add
        colleagues once you are signed in.
      </Note>
    </>
  );
}

export function ContactStep({ values, errors, onChange }: StepProps): React.JSX.Element {
  return (
    <>
      <Field
        label="Contact e-mail for event sites"
        type="email"
        value={values.scraperContactEmail}
        error={errors.scraperContactEmail}
        onChange={(value) => {
          onChange('scraperContactEmail', value);
        }}
        autoComplete="email"
        placeholder="compintel@example.edu"
        autoFocus
      />
      <Note icon={Mail}>
        Every request CompIntel makes to an event site says who it is and gives this address, so a
        site owner with a problem can write to a person instead of blocking a robot. Nothing is
        collected from any site until this is set.
      </Note>
    </>
  );
}
