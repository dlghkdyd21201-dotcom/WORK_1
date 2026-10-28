import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error)
      return (
        <main className="fatal-error" role="alert">
          <h1>화면을 불러오지 못했습니다.</h1>
          <p>{this.state.error.message}</p>
          <p>저장된 자료는 자동으로 삭제하지 않습니다.</p>
          <button onClick={() => window.location.reload()}>다시 열기</button>
        </main>
      );
    return this.props.children;
  }
}
createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
