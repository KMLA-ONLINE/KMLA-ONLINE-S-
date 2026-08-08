/**
 * 피드 타입.
 *
 * `list_feed_posts()` RPC가 아직 없어서 손으로 선언한다. 마이그레이션이 들어오면
 * `Database["public"]["Functions"]["list_feed_posts"]["Returns"][number]`에서 파생시키고
 * 이 파일을 지운다.
 */
export interface FeedPost {
  post_id: number;
  title: string;
  content: string;
  author_name: string;
  created_at: string;
}
