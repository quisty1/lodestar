export interface WeeklyMinimumCounts {
  posts: number;
  comments: number;
  reactions: number;
}

export interface WeeklyMinimumProgress {
  posts: boolean;
  comments: boolean;
  reactions: boolean;
  done: number;
  total: 3;
}

/** LinkedIn's practical weekly floor: one post, one comment, one reaction. */
export function weeklyMinimum(counts: WeeklyMinimumCounts): WeeklyMinimumProgress {
  const posts = counts.posts >= 1;
  const comments = counts.comments >= 1;
  const reactions = counts.reactions >= 1;
  return {
    posts,
    comments,
    reactions,
    done: [posts, comments, reactions].filter(Boolean).length,
    total: 3,
  };
}
