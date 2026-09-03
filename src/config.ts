export type MediaType = "movie" | "tv";
export type TimeBucket = "quick" | "standard" | "epic";

export const MOODS: Record<string, { movie: number[]; tv: number[]; exclude: number[] }> = {
  cozy: { movie: [35, 10751, 10749], tv: [35, 10751], exclude: [] },
  thrilling: { movie: [53, 28, 9648], tv: [80, 9648, 10759], exclude: [16, 10751, 35] },
  mindbending: { movie: [878, 9648, 53], tv: [10765, 9648], exclude: [16, 10751, 35] },
  laugh: { movie: [35], tv: [35], exclude: [16, 10751] },
  cry: { movie: [18, 10749], tv: [18], exclude: [16, 10751, 35] },
  spooky: { movie: [27, 53], tv: [9648, 80], exclude: [16, 10751, 35] },
  romantic: { movie: [10749, 18], tv: [18, 10766], exclude: [16, 10751, 27] },
  epic: { movie: [12, 28, 14], tv: [10759, 10765], exclude: [35] },
};

type FallbackPick = {
  title: string;
  year: string;
  overview: string;
  rating: number;
  runtime: number;
  genres: string[];
};

const picks = (items: [string, string, string, number, number, string[]][]): FallbackPick[] =>
  items.map(([title, year, overview, rating, runtime, genres]) => ({ title, year, overview, rating, runtime, genres }));

export const FALLBACK: Record<string, Record<MediaType, FallbackPick[]>> = {
  cozy: {
    movie: picks([["Paddington 2", "2017", "Paddington finds the perfect present, then must clear his name when it is stolen.", 7.5, 104, ["Family", "Comedy"]], ["Chef", "2014", "A chef rediscovers his joy and his family from behind a food-truck counter.", 7.3, 114, ["Comedy", "Drama"]]]),
    tv: picks([["Ted Lasso", "2020", "An optimistic football coach crosses an ocean and changes a club.", 8.8, 30, ["Comedy"]], ["Detectorists", "2014", "Two friends search fields for treasure and find a quieter kind of riches.", 8.6, 30, ["Comedy"]]]),
  },
  thrilling: {
    movie: picks([["Sicario", "2015", "An idealistic agent enters the brutal machinery of the border drug war.", 7.7, 122, ["Thriller", "Crime"]], ["The Guilty", "2018", "A dispatcher races against time using only a phone.", 7.5, 85, ["Thriller"]]]),
    tv: picks([["Bodyguard", "2018", "A veteran assigned to protect a politician is pulled into a conspiracy.", 8.0, 58, ["Thriller"]], ["Slow Horses", "2022", "Discarded intelligence officers stumble into threats no one else sees.", 8.3, 50, ["Thriller", "Drama"]]]),
  },
  mindbending: {
    movie: picks([["Arrival", "2016", "A linguist tries to understand visitors whose language reshapes time.", 7.9, 116, ["Science Fiction", "Drama"]], ["Coherence", "2013", "A dinner party fractures when a comet passes overhead.", 7.2, 89, ["Science Fiction", "Mystery"]]]),
    tv: picks([["Severance", "2022", "Office workers split their memories between work and home.", 8.7, 50, ["Mystery", "Drama"]], ["Dark", "2017", "A missing child exposes a town's knot of families and time.", 8.7, 55, ["Mystery", "Science Fiction"]]]),
  },
  laugh: {
    movie: picks([["Palm Springs", "2020", "Two wedding guests become stuck in the same day together.", 7.4, 90, ["Comedy", "Romance"]], ["Game Night", "2018", "A friendly game becomes an increasingly real mystery.", 6.9, 100, ["Comedy"]]]),
    tv: picks([["Derry Girls", "2018", "Teenagers navigate school and family during the Troubles.", 8.5, 24, ["Comedy"]], ["What We Do in the Shadows", "2019", "Vampire roommates struggle with modern Staten Island.", 8.6, 24, ["Comedy"]]]),
  },
  cry: {
    movie: picks([["Aftersun", "2022", "A daughter revisits a holiday with her young father.", 7.6, 102, ["Drama"]], ["Past Lives", "2023", "Childhood friends reunite in New York decades after parting.", 7.8, 106, ["Drama", "Romance"]]]),
    tv: picks([["Normal People", "2020", "Two Irish classmates move in and out of each other's lives.", 8.4, 30, ["Drama", "Romance"]], ["Maid", "2021", "A mother rebuilds a life for herself and her daughter.", 8.3, 55, ["Drama"]]]),
  },
  spooky: {
    movie: picks([["The Witch", "2015", "A family at the edge of a forest turns against itself.", 7.0, 92, ["Horror"]], ["Talk to Me", "2022", "A party ritual opens a door that should have stayed shut.", 7.1, 95, ["Horror", "Thriller"]]]),
    tv: picks([["The Haunting of Hill House", "2018", "A family confronts the house and grief that shaped them.", 8.5, 55, ["Horror", "Drama"]], ["Midnight Mass", "2021", "Miracles and dread arrive together on an isolated island.", 7.7, 64, ["Horror", "Drama"]]]),
  },
  romantic: {
    movie: picks([["Before Sunrise", "1995", "Two strangers spend one night walking and talking in Vienna.", 8.1, 101, ["Romance", "Drama"]], ["Rye Lane", "2023", "Two bruised romantics wander South London together.", 7.2, 82, ["Romance", "Comedy"]]]),
    tv: picks([["Starstruck", "2021", "A chance encounter complicates an ordinary London life.", 7.5, 22, ["Romance", "Comedy"]], ["Heartstopper", "2022", "Two schoolboys discover that friendship may be something more.", 8.5, 30, ["Romance", "Drama"]]]),
  },
  epic: {
    movie: picks([["Dune: Part Two", "2024", "Paul joins the Fremen while facing a choice that could reshape the universe.", 8.5, 166, ["Science Fiction", "Adventure"]], ["The Lord of the Rings: The Fellowship of the Ring", "2001", "A small fellowship carries a terrible burden toward Mordor.", 8.9, 179, ["Fantasy", "Adventure"]]]),
    tv: picks([["Shōgun", "2024", "War, faith, and ambition collide in feudal Japan.", 8.7, 60, ["Drama", "Adventure"]], ["Andor", "2022", "A thief becomes part of a rebellion against an empire.", 8.4, 45, ["Science Fiction", "Drama"]]]),
  },
};
