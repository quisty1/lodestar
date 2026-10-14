import { ref } from 'vue';
import { ChromeStorageStore } from '@/adapters/ChromeStorageStore';
import { IdeaBank } from '@lib/ideas/IdeaBank';
import { DraftStore } from '@lib/content/DraftStore';
import { loadContentSettings } from '@lib/content/settings';
import {
  remainingPosts,
  rolloverPostWeek,
  isoWeekKey,
  POST_WEEK_BUDGET_KEY,
  type PostWeek,
} from '@lib/content/PostWeekBudget';
import { IDEAS_LAST_RUN_KEY } from '@lib/ideas/IdeaDayBudget';
import type { Idea, Draft, IdeasLastRun } from '@lib/types';
import { panelBus } from '../lib/panelBus';

/** Side-panel state for the Content screen: idea bank + draft queue. */
export function useContent() {
  const store = new ChromeStorageStore();
  const bank = new IdeaBank(store);
  const drafts = new DraftStore(store);

  const tab = ref<'ideas' | 'drafts'>('ideas');
  const ideas = ref<Idea[]>([]);
  const draftList = ref<Draft[]>([]);
  const generating = ref(false);
  // Per-action pending keys so feedback lands on the CLICKED button, not a shared flag:
  // drafting = the to-draft/regenerate button key currently generating; approving = the draft id.
  const drafting = ref<string | null>(null);
  const approving = ref<string | null>(null);
  const savedDraft = ref<string | null>(null);
  const error = ref<string | null>(null);
  const postsLeft = ref(0);
  const lastRun = ref<IdeasLastRun | null>(null);

  async function loadIdeas() {
    ideas.value = await bank.allNewestFirst();
  }

  /** The most recent AUTO idea-collect during a run (written by the SW on every path). */
  async function loadLastRun() {
    lastRun.value = (await store.get<IdeasLastRun>(IDEAS_LAST_RUN_KEY)) ?? null;
  }

  async function generateIdeas() {
    generating.value = true;
    error.value = null;
    const res = await panelBus.request<{ ideas: Idea[]; error?: string }>({
      type: 'GENERATE_IDEAS',
    });
    generating.value = false;
    if (res?.error) error.value = res.error;
    ideas.value = await bank.allNewestFirst();
    await loadLastRun();
  }

  async function removeIdea(idea: Idea) {
    await bank.remove(idea);
    await loadIdeas();
  }

  async function loadDrafts() {
    const all = await drafts.all();
    draftList.value = [...all].sort(
      (a, b) => Number(b.approved ?? false) - Number(a.approved ?? false),
    );
  }

  async function toDraft(idea: Idea, key: string) {
    drafting.value = key;
    error.value = null;
    try {
      const res = await panelBus.request<{ draft: Draft | null; error?: string }>({
        type: 'GENERATE_DRAFT',
        idea,
      });
      if (res?.error) error.value = res.error;
      else if (!res?.draft) error.value = 'transport_unavailable';
      await loadDrafts();
      if (res?.draft) tab.value = 'drafts';
    } finally {
      drafting.value = null;
    }
  }

  async function removeDraft(id: string) {
    await drafts.remove(id);
    await loadDrafts();
  }

  async function approveDraft(id: string, approved: boolean) {
    approving.value = id;
    await drafts.setApproved(id, approved);
    await loadDrafts();
    approving.value = null;
  }

  async function setMedia(id: string, mediaAttached: boolean) {
    await drafts.setMedia(id, mediaAttached);
    await loadDrafts();
  }

  async function setKind(id: string, kind: Draft['kind']) {
    await drafts.setKind(id, kind);
    await loadDrafts();
  }

  async function updateDraft(id: string, text: string) {
    await drafts.update(id, text);
    await loadDrafts();
    savedDraft.value = id;
    setTimeout(() => {
      if (savedDraft.value === id) savedDraft.value = null;
    }, 1600);
  }

  /** Remaining publishes this ISO-week, against the configured weekly cap. */
  async function loadPostBudget() {
    const [{ postsPerWeek }, rawBudget] = await Promise.all([
      loadContentSettings(store),
      store.get<PostWeek>(POST_WEEK_BUDGET_KEY),
    ]);
    const budget = rolloverPostWeek(rawBudget ?? null, isoWeekKey(new Date()));
    postsLeft.value = remainingPosts(budget, postsPerWeek);
  }

  return {
    tab,
    ideas,
    drafts: draftList,
    generating,
    drafting,
    approving,
    savedDraft,
    error,
    postsLeft,
    lastRun,
    loadIdeas,
    generateIdeas,
    removeIdea,
    loadLastRun,
    loadDrafts,
    toDraft,
    removeDraft,
    updateDraft,
    approveDraft,
    setMedia,
    setKind,
    loadPostBudget,
  };
}
