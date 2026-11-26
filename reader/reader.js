"use strict";

window.startReader = function startReader(catalog, vault) {
  const { collections } = catalog;
  const byId = id => document.getElementById(id);
  const books = new Map(catalog.books.map(book => [book.id, book]));
  const content = byId("content");
  const navigation = byId("navigation");
  const topicNav = byId("topic-nav");
  const primaryNav = byId("collections");
  const filter = byId("filter");
  const status = byId("status");
  const source = byId("source");
  const previous = byId("previous");
  const next = byId("next");
  const studyControls = byId("study-controls");
  const studyToggle = byId("study-toggle");
  const studyActions = byId("study-actions");
  const studyKey = "interview-reader-self-test";
  const header = document.querySelector(".topbar");
  const chapterCache = new Map();
  const pending = new Map();
  const headingMaps = new Map();
  let selection = {};
  let renderedChapter;
  let routeVersion = 0;
  let imageObserver;
  let imageUrls = [];
  let questions = [];
  let highlighted;
  let studyMode = false;
  try { studyMode = localStorage.getItem(studyKey) === "true"; } catch {}

  for (const book of books.values()) {
    const headings = new Map();
    for (const chapter of book.chapters) {
      for (const heading of chapter.headings) headings.set(heading.id, chapter);
    }
    headingMaps.set(book, headings);
  }

  function route(id, heading = "") {
    return "#" + id + "/" + encodeURIComponent(heading);
  }

  function link(title, href, active = false) {
    const element = document.createElement("a");
    element.textContent = title;
    element.href = href;
    if (active) element.setAttribute("aria-current", "page");
    return element;
  }

  function setMenu(open) {
    document.body.classList.toggle("nav-open", open);
    byId("menu").setAttribute("aria-expanded", String(open));
  }

  function groups(book) {
    return [...new Set(book.chapters.map(chapter => chapter.group).filter(Boolean))];
  }

  function questionHeadings(chapter) {
    return chapter.headings.filter(heading => heading.level === (chapter.questionLevel ?? 3));
  }

  function prepareChapterToc(book, chapter) {
    const title = content.firstElementChild;
    if (title?.id !== chapter.id) return;

    const directory = route(book.id);
    const first = title.nextElementSibling;
    if (!first?.matches("p") || !first.querySelector('a[href="' + directory + '"]')) {
      const paragraph = document.createElement("p");
      paragraph.append(link("返回总目录", directory));
      title.after(paragraph);
    }

    const existing = Array.from(content.children).some(node =>
      node.matches("p") && node.textContent.trim() === "本章导航" &&
      node.nextElementSibling?.matches("ul, ol"));
    if (existing) return;

    const headings = chapter.headings.filter(heading => heading.id !== chapter.id);
    const questions = questionHeadings(chapter);
    const entries = questions.length ? questions : headings;
    if (!entries.length) return;

    const caption = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = "本章导航";
    caption.append(strong);
    const outline = document.createElement("ul");
    for (const heading of entries) {
      const item = document.createElement("li");
      item.append(link(heading.title, route(book.id, heading.id)));
      outline.append(item);
    }
    title.nextElementSibling.after(caption, outline);
  }

  function updateStudyControls() {
    studyControls.hidden = !questions.length;
    studyActions.hidden = !studyMode;
    studyToggle.textContent = studyMode ? "自测模式：开" : "自测模式";
    studyToggle.setAttribute("aria-pressed", String(studyMode));
  }

  function setAnswer(question, open) {
    question.answer.hidden = !open;
    question.button.setAttribute("aria-expanded", String(open));
    question.hint.textContent = open ? "收起答案" : "点击看答案";
  }

  function prepareQuestions(chapter) {
    questions = questionHeadings(chapter).flatMap(({ id }) => {
      const heading = document.getElementById(id);
      // Each question owns the sibling blocks up to the next peer or parent heading.
      if (heading?.parentElement !== content) return [];
      const answer = document.createElement("div");
      answer.className = "question-answer";
      answer.id = id + "--answer";
      let node = heading.nextSibling;
      const level = Number(heading.tagName[1]);
      while (node && !(node.nodeType === Node.ELEMENT_NODE && /^H[1-6]$/.test(node.tagName)
        && Number(node.tagName[1]) <= level)) {
        const following = node.nextSibling;
        answer.append(node);
        node = following;
      }
      heading.after(answer);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "question-toggle";
      button.setAttribute("aria-controls", answer.id);
      const label = document.createElement("span");
      label.append(...heading.childNodes);
      const hint = document.createElement("span");
      hint.className = "question-hint";
      button.append(label, hint);
      heading.classList.add("question-heading");
      heading.append(button);
      const question = { heading, button, label, hint, answer };
      button.addEventListener("click", () => setAnswer(question, answer.hidden));
      for (const lead of answer.querySelectorAll("p > strong:first-child")) {
        if (lead.textContent === "一句话结论") lead.classList.add("answer-lead");
      }
      return [question];
    });
    applyStudyMode();
  }

  function applyStudyMode() {
    for (const question of questions) {
      const { heading, button, label } = question;
      if (studyMode) {
        if (!heading.contains(button)) {
          label.append(...heading.childNodes);
          heading.append(button);
        }
      } else if (heading.contains(button)) {
        button.replaceWith(...label.childNodes);
      }
      setAnswer(question, !studyMode);
    }
    content.classList.toggle("study-mode", studyMode);
    updateStudyControls();
  }

  function groupNav(book, group) {
    return groups(book).map(label => link(label, route(book.id, "~" + label), label === group));
  }

  function updateNavigation() {
    const { collection, book, group, chapter } = selection;
    const query = filter.value.trim().toLocaleLowerCase();
    byId("nav-label").textContent = query ? "匹配的标题" : "篇目与标题";
    navigation.replaceChildren();
    if (query) {
      const scope = collection ? collection.books.map(id => books.get(id)) : [...books.values()];
      let matches = 0;
      for (const item of scope) {
        for (const entry of item.chapters) {
          for (const heading of entry.headings) {
            if (!heading.title.toLocaleLowerCase().includes(query)) continue;
            if (matches++ >= 120) continue;
            const result = link(heading.title, route(item.id, heading.id));
            if (heading.id !== entry.id) {
              const caption = document.createElement("span");
              caption.className = "result-chapter";
              caption.textContent = entry.title;
              result.append(caption);
            }
            navigation.append(result);
          }
        }
      }
      if (!matches) navigation.textContent = "稍换关键词再试。";
      if (matches > 120) navigation.append("已显示前 120 项，请缩小搜索范围。");
      return;
    }
    if (!book) {
      const entries = collection
        ? collection.books.map(id => books.get(id))
        : collections;
      navigation.append(...entries.map(item => link(item.title, route(item.id))));
      return;
    }
    if (chapter) {
      const outline = document.createDocumentFragment();
      const headings = questionHeadings(chapter);
      for (const heading of headings.length ? headings : chapter.headings) {
        if (heading.id === chapter.id) continue;
        outline.append(link(heading.title, route(book.id, heading.id), heading.id === selection.heading));
      }
      if (outline.childElementCount) {
        navigation.append(link("返回篇目", route(book.id, group ? "~" + group : "")), outline);
        return;
      }
    }
    const entries = book.chapters.filter(item => !group || item.group === group);
    if (!group && groups(book).length > 1) navigation.append(...groupNav(book));
    else navigation.append(...entries.map(item => link(item.title, route(book.id, item.id), item === chapter)));
  }

  function clearImages() {
    imageObserver?.disconnect();
    for (const url of imageUrls) URL.revokeObjectURL(url);
    imageUrls = [];
  }

  function showIndex(title, entries, cards = false) {
    clearImages();
    const heading = document.createElement("h1");
    heading.textContent = title;
    const list = document.createElement("ul");
    list.className = cards ? "chapter-list book-list" : "chapter-list";
    for (const [label, href, note] of entries) {
      const item = document.createElement("li");
      const anchor = link(label, href);
      if (note) {
        const caption = document.createElement("small");
        caption.textContent = note;
        anchor.append(caption);
      }
      item.append(anchor);
      list.append(item);
    }
    content.replaceChildren(heading, list);
    renderedChapter = undefined;
    questions = [];
    highlighted = undefined;
    updateStudyControls();
  }

  function renderOverview({ collection, book, group }) {
    if (!collection) {
      showIndex("面试资料库", collections.map(item => [item.title, route(item.id), item.note]), true);
      return;
    }
    if (!book) {
      showIndex(collection.title, collection.books.map(id => {
        const item = books.get(id);
        return [item.title, route(id), item.chapters.length + " 篇"];
      }), true);
      return;
    }
    if (!group && groups(book).length > 1) {
      showIndex(book.title, groups(book).map(label => [
        label, route(book.id, "~" + label),
        book.chapters.filter(item => item.group === label).length + " 篇",
      ]), true);
      return;
    }
    showIndex(group || book.title, book.chapters.filter(item => !group || item.group === group)
      .map(item => {
        const count = item.questionCount ?? questionHeadings(item).length;
        return [item.title, route(book.id, item.id), count || book.id === "hot100" ? count + " 题" : ""];
      }));
  }

  function oldChapter(file, key) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      const receive = data => {
        if (data.book + "/" + data.chapter === key) resolve(data);
      };
      chapterReceivers.add(receive);
      script.src = file;
      script.onload = script.onerror = () => {
        chapterReceivers.delete(receive);
        script.remove();
        reject(new Error("章节文件加载失败。"));
      };
      document.head.append(script);
    });
  }

  const chapterReceivers = new Set();
  window.readerReceiveChapter = data => {
    for (const receive of chapterReceivers) receive(data);
  };

  function loadChapter(book, chapter) {
    const key = book.id + "/" + chapter.id;
    if (chapterCache.has(key)) return Promise.resolve(chapterCache.get(key));
    if (pending.has(key)) return pending.get(key);
    const load = vault ? vault.json(chapter.file)
      : chapter.file.endsWith(".json")
        ? fetch(chapter.file).then(response => {
          if (!response.ok) throw new Error("章节文件加载失败。");
          return response.json();
        })
        : oldChapter(chapter.file, key);
    const task = load.then(data => {
      if (data.book !== book.id || data.chapter !== chapter.id) throw new Error("章节索引与正文不匹配。");
      chapterCache.set(key, data.html);
      if (chapterCache.size > 3) chapterCache.delete(chapterCache.keys().next().value);
      return data.html;
    }).finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  }

  function renderMarkup(markup) {
    clearImages();
    const template = document.createElement("template");
    template.innerHTML = markup;
    const queued = new Map();
    for (const image of template.content.querySelectorAll("img[src]")) {
      const url = image.getAttribute("src");
      const original = image.closest("a");
      const pictureLink = original || document.createElement("a");
      if (!original) {
        pictureLink.className = "image-link";
        pictureLink.title = "查看原图";
        pictureLink.target = "_blank";
        pictureLink.rel = "noopener noreferrer";
        image.replaceWith(pictureLink);
        pictureLink.append(image);
      }
      if (vault?.has(url)) {
        image.removeAttribute("src");
        const href = pictureLink.getAttribute("href");
        if (!original || href === url) pictureLink.removeAttribute("href");
        queued.set(image, { url, pictureLink: !original || href === url ? pictureLink : null });
      } else if (!original) {
        pictureLink.href = url;
      }
    }
    content.replaceChildren(template.content);
    imageObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const image = entry.target;
        imageObserver.unobserve(image);
        const { url, pictureLink } = queued.get(image);
        queued.delete(image);
        vault.blob(url).then(blob => {
          if (!image.isConnected) return;
          const src = URL.createObjectURL(blob);
          imageUrls.push(src);
          image.src = src;
          if (pictureLink) pictureLink.href = src;
        }).catch(() => {
          if (image.isConnected) image.replaceWith(image.alt || "图片加载失败");
        });
      }
    }, { rootMargin: "700px" });
    for (const image of queued.keys()) imageObserver.observe(image);
  }

  function getSelection() {
    const [id, suffix = ""] = location.hash.slice(1).split("/", 2);
    let heading = "";
    try { heading = decodeURIComponent(suffix); } catch {}
    const book = books.get(id);
    const collection = collections.find(item => item.id === id || item.books.includes(id));
    const chapter = book && headingMaps.get(book).get(heading);
    const group = chapter?.group || (book && heading.startsWith("~") && groups(book).find(item => item === heading.slice(1)));
    return { collection, book, chapter, group, heading };
  }

  async function renderRoute() {
    const version = ++routeVersion;
    const current = getSelection();
    if (selection.collection !== current.collection) filter.value = "";
    selection = current;
    const { collection, book, chapter, group, heading } = selection;
    primaryNav.replaceChildren(...collections.map(item => link(item.title, route(item.id), item === collection)));
    const sublinks = collection?.id === "java"
      ? collection.books.map(id => link(books.get(id).title, route(id), book?.id === id))
      : book && groups(book).length > 1 ? groupNav(book, group) : [];
    topicNav.replaceChildren(...sublinks);
    topicNav.hidden = !sublinks.length;
    byId("location").textContent = [collection?.title, collection?.id === "java" ? book?.title : group, chapter?.title]
      .filter(Boolean).join(" / ");
    document.title = ([chapter?.title || collection?.title, "面试资料库"].filter(Boolean)).join(" · ");
    source.hidden = !book?.source;
    source.href = book?.source && !vault ? book.source : "#";
    source.textContent = "完整 Markdown";
    const index = chapter ? book.chapters.indexOf(chapter) : -1;
    previous.disabled = index <= 0;
    next.disabled = index < 0 || index + 1 >= book.chapters.length;
    previous.closest("footer").hidden = !chapter;
    updateNavigation();
    setMenu(false);
    if (!chapter) {
      renderOverview(selection);
      status.textContent = heading && !group ? "目录中找不到该标题。" : "";
      window.scrollTo(0, 0);
      return;
    }
    status.textContent = "正在加载…";
    try {
      const markup = await loadChapter(book, chapter);
      if (version !== routeVersion) return;
      const sameChapter = renderedChapter === chapter;
      if (!sameChapter) {
        renderMarkup(markup);
        prepareChapterToc(book, chapter);
        prepareQuestions(chapter);
        renderedChapter = chapter;
      }
      const target = document.getElementById(heading);
      if (!target || !content.contains(target)) throw new Error("目录中找不到该标题。");
      highlighted?.classList.remove("heading-highlight");
      highlighted = undefined;
      const question = questions.find(item => item.answer.contains(target));
      if (question?.answer.hidden) setAnswer(question, true);
      for (let ancestor = target.parentElement; ancestor && ancestor !== content; ancestor = ancestor.parentElement) {
        if (ancestor.tagName === "DETAILS") ancestor.open = true;
      }
      if (heading === chapter.id) window.scrollTo(0, 0);
      else {
        highlighted = question?.heading || target;
        highlighted.classList.add("heading-highlight");
        const control = studyMode && questions.find(item => item.heading === target)?.button;
        (control || target).focus({ preventScroll: true });
        const smooth = sameChapter && studyMode && !matchMedia("(prefers-reduced-motion: reduce)").matches;
        target.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "instant" });
      }
      status.textContent = "";
    } catch (error) {
      if (version !== routeVersion) return;
      clearImages();
      content.textContent = error.message;
      status.textContent = "加载失败";
      renderedChapter = undefined;
      questions = [];
      highlighted = undefined;
      updateStudyControls();
    }
  }

  async function downloadProtected(file) {
    try {
      const url = URL.createObjectURL(await vault.blob(file));
      const download = link("", url);
      download.download = decodeURIComponent(file.split("/").pop());
      document.body.append(download);
      download.click();
      download.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      status.textContent = "附件下载失败。";
    }
  }

  function adjacent(offset) {
    const { book, chapter } = selection;
    const target = book.chapters[book.chapters.indexOf(chapter) + offset];
    if (target) location.hash = route(book.id, target.id);
  }

  header.hidden = false;
  document.querySelector(".layout").hidden = false;
  new ResizeObserver(() => document.documentElement.style.setProperty(
    "--header-height", Math.ceil(header.getBoundingClientRect().height) + "px",
  )).observe(header);
  filter.addEventListener("input", updateNavigation);
  studyToggle.addEventListener("click", () => {
    studyMode = !studyMode;
    try { localStorage.setItem(studyKey, String(studyMode)); } catch {}
    applyStudyMode();
  });
  byId("study-expand").addEventListener("click", () => {
    for (const question of questions) setAnswer(question, true);
  });
  byId("study-collapse").addEventListener("click", () => {
    for (const question of questions) setAnswer(question, false);
  });
  source.addEventListener("click", event => {
    if (!vault || !selection.book?.source) return;
    event.preventDefault();
    downloadProtected(selection.book.source);
  });
  content.addEventListener("click", event => {
    const file = event.target.closest("a[href]")?.getAttribute("href");
    if (!file || !vault?.has(file)) return;
    event.preventDefault();
    downloadProtected(file);
  });
  byId("menu").addEventListener("click", () => setMenu(!document.body.classList.contains("nav-open")));
  previous.addEventListener("click", () => adjacent(-1));
  next.addEventListener("click", () => adjacent(1));
  document.addEventListener("click", event => {
    const anchor = event.target.closest("a[href]");
    if (!anchor || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const href = anchor.getAttribute("href");
    if (!href.startsWith("#")) return;
    event.preventDefault();
    if (location.hash === href) renderRoute();
    else location.hash = href;
  });
  window.addEventListener("hashchange", renderRoute);
  renderRoute();
};
