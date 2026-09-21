"use client";

import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";

import { Button } from "./ui/button";
import { Card } from "./ui/card";

type Props = { children: ReactNode };
type State = { failed: boolean; revision: number };

export class AuthErrorBoundary extends Component<Props, State> {
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
            <div role="alert">
              <h1 className="font-serif text-3xl font-semibold text-[#432f35]">
                We couldn't open your private workspace.
              </h1>
              <p className="mt-3 leading-7 text-[#725f62]">
                Your invitation pages are unaffected. Try loading your account
                again.
              </p>
            </div>
            <Button className="mt-6" onClick={this.retry}>
              Try again
            </Button>
          </Card>
        </main>
      );
    }

    return <Fragment key={this.state.revision}>{this.props.children}</Fragment>;
  }
}
