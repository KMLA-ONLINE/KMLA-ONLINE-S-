import type { HeraldArticle, HeraldPoll } from "../model/types";

// Design fixtures only. These are not records from Supabase or historical reporting.
export const demoArticles: HeraldArticle[] = [
  {
    id: "beyond-the-classroom",
    title: "The stories we carry beyond the classroom",
    category: "Feature",
    deck: "Between the first bell and the last light, a different kind of education unfolds. A look at the little moments that make a community.",
    body: "A school is more than a collection of classrooms. It is the conversation that continues after the bell, the idea scribbled in a notebook, and the familiar face on the walk back from dinner.\n\nThis sample feature imagines a slower tour through campus life. What do we notice when we stop counting the hours and start paying attention to the people around us?\n\nThe Herald is a place for those stories: thoughtful, curious, and told by the students who live them. This is illustrative copy for the design preview, not a published report.",
    image: "/herald/campus.jpg",
    credit: "Placeholder photograph: Tim Alex / Unsplash. Not the KMLA campus.",
    date: "Nov 4, 2026",
  },
  {
    id: "humans-of-the-scene",
    title: "Humans of the Scene: beyond the curtain",
    category: "Feature",
    deck: "The lights go down. The stories stay with us. Meet the voices behind a school production.",
    body: "Every performance has another story waiting in the wings: the rehearsals, the friendships, and the work an audience never sees.\n\nThis preview takes its visual inspiration from the Herald’s Humans of The Scene series. The photograph comes from the supplied Facebook reference; this accompanying copy is a placeholder and is not a quotation from the person pictured.\n\nA full story can bring together an interview, a photo essay, and the writer’s reflections in one place.",
    image: "/herald/the-scene.jpg",
    credit:
      "Minjok Herald / supplied Facebook reference. Illustrative article copy.",
    date: "Nov 3, 2026",
  },
  {
    id: "between-pages",
    title: "In praise of getting lost between the pages",
    category: "Editorial",
    deck: "An invitation to put the screen down and pick up something unexpected.",
    body: "The best reading lists sometimes begin with a book you did not mean to find. A title on the next shelf. A recommendation from a friend. A paragraph that makes you pause.\n\nThis sample culture column leaves space for students’ book recommendations, thoughtful reviews, and the discoveries that deserve to be shared.\n\nThe text and photograph are placeholders for the design preview.",
    image: "/herald/library.jpg",
    credit: "Placeholder photograph: Emil Widlund / Unsplash.",
    date: "Nov 2, 2026",
  },
  {
    id: "life-in-the-screen",
    title: "Life in the Screen: inside our 70th edition",
    category: "News",
    deck: "A semester’s worth of questions about the digital world, collected in one edition.",
    body: "The supplied 70th edition carries the theme Life in the Screen. Read the original, complete 48-page PDF in the edition archive.\n\nThis short introduction is sample copy for the web layout. The original edition remains unchanged, including its contributors, artwork, and articles.",
    image: "/herald/edition-70.jpg",
    credit: "Cover of the supplied Minjok Herald 70th edition.",
    date: "Nov 1, 2026",
  },
  {
    id: "a-question-worth-asking",
    title: "A good interview starts with a better question",
    category: "Feature",
    deck: "Listening closely, looking again, and finding the story behind the first answer.",
    body: "What turns a conversation into a story? Often it is the follow-up question: a small invitation to go beyond the rehearsed answer.\n\nThis is a sample newsroom note, paired with a photograph from the supplied Herald Facebook reference. It is not an interview with or a quotation from the person pictured.",
    image: "/herald/interview.jpg",
    credit:
      "Minjok Herald / supplied Facebook reference. Illustrative article copy.",
    date: "Oct 30, 2026",
  },
];

export const demoPolls: HeraldPoll[] = [
  {
    id: "next-story",
    title: "What should we cover next?",
    options: [
      { id: "campus", label: "Everyday campus life", votes: 42 },
      { id: "people", label: "People & their stories", votes: 31 },
      { id: "culture", label: "Arts, books & culture", votes: 18 },
    ],
    choice: null,
    closed: false,
  },
];
