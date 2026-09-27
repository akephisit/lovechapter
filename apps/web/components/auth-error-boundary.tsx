"use client";

import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import type { UiCopy } from "../lib/ui-copy";

import { LanguageSwitcher } from "./language-switcher";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { useUiCopy } from "./ui-language-provider";

type Props = { children: ReactNode; copy: UiCopy };
type State = { failed: boolean; revision: number };

export function AuthErrorBoundary({ children }: { children: ReactNode }) {
  const copy = useUiCopy();
  return (
    <AuthErrorBoundaryInner copy={copy}>{children}</AuthErrorBoundaryInner>
  );
}

class AuthErrorBoundaryInner extends Component<Props, State> {
  override state: State = { failed: false, revision: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Authentication failures are intentionally isolated from public RSVP routes.
  }

  private retry = () => {
    this.setState(({ revision }) => ({
      failed: false,
      revision: revision + 1,
    }));
  };

  override render() {
    if (this.state.failed) {
      return (
        <main className="grid min-h-screen place-items-center px-4 py-10">
          <Card className="w-full max-w-lg p-8 text-center">
            <div className="mb-4 flex justify-end">
              <LanguageSwitcher />
            </div>
            <div role="alert">
              <h1 className="font-serif text-3xl font-semibold text-[#432f35]">
                {this.props.copy.session.boundaryTitle}
              </h1>
              <p className="mt-3 leading-7 text-[#725f62]">
                {this.props.copy.session.boundaryDescription}
              </p>
            </div>
            <Button className="mt-6" onClick={this.retry}>
              {this.props.copy.session.retry}
            </Button>
          </Card>
        </main>
      );
    }

    return <Fragment key={this.state.revision}>{this.props.children}</Fragment>;
  }
}
