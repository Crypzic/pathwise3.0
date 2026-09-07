import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import { FeaturesProvider, useFeatures, type Features } from "./lib/features";
import { ThemeProvider } from "./lib/theme";
import { ToastProvider } from "./lib/toast";
import SignIn from "./pages/SignIn";
import SignUp from "./pages/SignUp";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Privacy from "./pages/Privacy";
import Courses from "./pages/Courses";
import NewCourse from "./pages/NewCourse";
import CourseView from "./pages/CourseView";
import Upgrade from "./pages/Upgrade";
import StudyPlan from "./pages/StudyPlan";
import Quiz from "./pages/Quiz";
import Socratic from "./pages/Socratic";
import SocraticChat from "./pages/SocraticChat";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import Onboarding from "./pages/Onboarding";
import Game from "./pages/Game";
import Shop from "./pages/Shop";
import Communities from "./pages/Communities";
import CommunityView from "./pages/CommunityView";
import PostView from "./pages/PostView";
import Buddies from "./pages/Buddies";
import Messages from "./pages/Messages";
import Videos from "./pages/Videos";
import VideoWatch from "./pages/VideoWatch";
import CreatorStudio from "./pages/CreatorStudio";
import StudyRoom from "./pages/StudyRoom";
import TopicView from "./pages/TopicView";

function FullPageLoader() {
  return (
    <div className="auth-wrap">
      <p style={{ color: "var(--ink-soft)" }} role="status">
        Loading…
      </p>
    </div>
  );
}

// Requires a signed-in user who has accepted the privacy statement.
function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/signin" replace />;
  if (!user.privacyAccepted) return <Navigate to="/privacy" replace />;
  return <>{children}</>;
}

// Auth screens redirect away if already fully signed in. Guests are the
// exception: they must be able to reach /signup to claim their account (and
// /signin to switch to a real one).
function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (user && user.privacyAccepted && !user.isGuest) {
    return <Navigate to="/courses" replace />;
  }
  return <>{children}</>;
}

// Renders children only when a feature flag is on; otherwise sends the user
// back to Courses. Waits for /api/config so a slow answer doesn't bounce
// someone off a screen that's actually enabled.
function FeatureGate({
  flag,
  children,
}: {
  flag: keyof Features;
  children: React.ReactNode;
}) {
  const features = useFeatures();
  if (!features.loaded) return <FullPageLoader />;
  if (!features[flag]) return <Navigate to="/courses" replace />;
  return <>{children}</>;
}

// Privacy screen: needs a user, but only before they've accepted.
function PrivacyGate() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/signin" replace />;
  if (user.privacyAccepted) return <Navigate to="/courses" replace />;
  return <Privacy />;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/signin" element={<PublicOnly><SignIn /></PublicOnly>} />
      <Route path="/signup" element={<PublicOnly><SignUp /></PublicOnly>} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/privacy" element={<PrivacyGate />} />

      {/* First-run wizard, also the learning-profile editor (Phase 2). */}
      <Route path="/onboarding" element={<Protected><Onboarding /></Protected>} />

      <Route path="/courses" element={<Protected><Courses /></Protected>} />
      <Route path="/courses/new" element={<Protected><NewCourse /></Protected>} />
      <Route path="/courses/:id" element={<Protected><CourseView /></Protected>} />
      {/* The learning layer: lecturer-grade topic breakdowns + Ask PATHWISE. */}
      <Route path="/topics/:topicId" element={<Protected><TopicView /></Protected>} />
      <Route path="/study-plan/:id" element={<Protected><StudyPlan /></Protected>} />

      {/* Quizzes and Socratic sessions are server-side sessions, so their ids
          are in the URL — a refresh resumes exactly where the student was. The
          id-less forms resume the most recent session or pick a course. */}
      <Route path="/quiz" element={<Protected><Quiz /></Protected>} />
      <Route path="/quiz/:sessionId" element={<Protected><Quiz /></Protected>} />
      <Route path="/socratic" element={<Protected><Socratic /></Protected>} />
      <Route path="/socratic/chat/:sessionId" element={<Protected><SocraticChat /></Protected>} />

      <Route path="/progress" element={<Protected><Dashboard /></Protected>} />
      <Route path="/progress/:id" element={<Protected><Dashboard /></Protected>} />

      {/* Communities (PATHWISE 2.0 Phase 9). Account-gated server-side;
          guests see a claim-your-account screen. */}
      <Route path="/communities" element={<Protected><Communities /></Protected>} />
      <Route path="/communities/:id" element={<Protected><CommunityView /></Protected>} />
      <Route path="/communities/posts/:postId" element={<Protected><PostView /></Protected>} />
      {/* Study Buddy Matching (PATHWISE 2.0 Phase 10). */}
      <Route path="/buddies" element={<Protected><Buddies /></Protected>} />
      {/* Direct messages (PATHWISE 2.0 Phase 12). */}
      <Route path="/messages" element={<Protected><Messages /></Protected>} />
      <Route path="/messages/:conversationId" element={<Protected><Messages /></Protected>} />
      {/* Curated educational videos (PATHWISE 2.0 Phase 14). */}
      <Route path="/videos" element={<Protected><Videos /></Protected>} />
      <Route path="/videos/:id" element={<Protected><VideoWatch /></Protected>} />
      {/* Creator Studio (Phase 16) — dark until the server flag flips. */}
      <Route path="/creator" element={<Protected><FeatureGate flag="userVideoPosting"><CreatorStudio /></FeatureGate></Protected>} />
      {/* Study buddy rooms (Phases 11/19 MVP). */}
      <Route path="/rooms/:roomId" element={<Protected><StudyRoom /></Protected>} />

      <Route path="/profile" element={<Protected><Profile /></Protected>} />
      {/* Frozen behind a flag (PATHWISE 2.0 Phase 0) — kept for a clean
          future replacement by Wise Path. */}
      <Route path="/game" element={<Protected><FeatureGate flag="leafMatch"><Game /></FeatureGate></Protected>} />
      <Route path="/shop" element={<Protected><FeatureGate flag="leafMatch"><Shop /></FeatureGate></Protected>} />
      <Route path="/upgrade" element={<Protected><Upgrade /></Protected>} />

      <Route path="*" element={<Navigate to="/courses" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <FeaturesProvider>
        <AuthProvider>
          <ToastProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </ToastProvider>
        </AuthProvider>
      </FeaturesProvider>
    </ThemeProvider>
  );
}
