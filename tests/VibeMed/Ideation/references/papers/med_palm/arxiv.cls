%%%%%%%%%
%
% Basic style file for DeepMind open-access papers, internal reports, and unpublished % 
% papers.
%
% This class allows for several options depending on the preferences of the authors.
% Use it in the following way, with the full set of option possible:
% \documentclass[11pt, a4paper, twocolumn, logo, address, copyright, nonumbering, 
% internal]{deepmind} 
%
% Options:
%    - 11pt: Sets the normal font size of the text. Can be only 10, 11, 12pt.
%    - a4paper: Paper size. Usually would not adjust.
%    - twocolumn: Makes the paper into two column mode; single column by default.
%    - logo: Adds the DeepMind logo to the top left. No logo included if left out.
%    - address: Add a postal address for correspondence to the bottom footer.
%    - copyright: Add a copyright statement to the first page of the paper in the left footnote
%    - nonumbering: Uses unnumbered sections.
%    - internal: for internal only docs that should not be shared externally. 
%           Can only use techreportnumber with this option.
%
% Date of Paper
%   The report is by default given the current date in the top right. If you want to fix the 
%   date: add the date to your preamble with your own date as follows:
%   \renewcommand{\today}{1 January 2000}
%
% Confidentiality
%   Change the confidentiality statement for internal docs by adding this in the preamble 
%   \renewcommand{\internal}{Confidential.}
%   
% ----------------
% Licence: This template is released under the Creative Commons licence 
% Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)
%
% Known issues:
%   - Package todonotes does not work in the abstract
%
% Version history: 
% v0.31, May 2019 - Allow corresponding authors without internal option
% v0.3, March 2019 - Math font consistency, better handling of optional arguments
% v0.2, January 2019 - Consistency of fonts, margins, additional notes
% v0.1, December 2018 - Initial version for testing
%
% Ongoing Review
%    We review and improve this regularly. 
%    Send comments to shakir@
%
%  DeepMind, London, 2019
%
% %%%%%%%%%%%%%%%

\NeedsTeXFormat{LaTeX2e}
%\ProvidesClass{deepmind}[07-02-2019, v0.2]
% Removed the versioning since this doesn't work well with arxiv.
\ProvidesClass{arxiv}
\AtEndOfClass{\RequirePackage[tracking=smallcaps]{microtype}}
\DeclareOption*{\PassOptionsToClass{\CurrentOption}{extarticle}}
\ProcessOptions*
\LoadClass{extarticle} 

%%======== Packages Required ========
% Fonts and language
\RequirePackage[utf8]{inputenc}
\RequirePackage[english]{babel}
\RequirePackage{amsthm, amsmath, amsfonts, amssymb}
\RequirePackage[T1]{fontenc}
\RequirePackage[hyphens]{url}
\RequirePackage[dvipsnames]{xcolor}
\RequirePackage{xifthen}
\RequirePackage{textcomp} % For copyright symbol styling
\RequirePackage[overload]{textcase}
\RequirePackage{balance}
%% *Graphics, tables and other formatting
\RequirePackage{graphicx}
\RequirePackage{colortbl}
\RequirePackage{booktabs}
\RequirePackage{changepage}
\RequirePackage{enumitem} % For reducing bullet list item separation
\RequirePackage{tabularx}
\RequirePackage{datetime}
% Headers and footers
\RequirePackage{fancyhdr}  % custom headers/footers
\RequirePackage{lastpage}  % Number of pages in the document
% Lists and their spacing
\RequirePackage{enumitem} 
\setlist[itemize]{noitemsep}
\setlist[enumerate]{noitemsep}
% Title, Abstract, Bibliography
\RequirePackage[explicit]{titlesec}
\RequirePackage{bibentry}
\RequirePackage{mdframed}
\RequirePackage{setspace}
\RequirePackage{needspace}
\RequirePackage{etex}
\RequirePackage[skip=6pt,font={footnotesize,stretch=1.1},belowskip=6pt]{caption}
\RequirePackage[font=footnotesize,%
                skip=6pt,subrefformat=parens,%
                justification=centering,%
                labelfont={sf}]{subcaption}


% Breaking lines for URLs in the bib 
% \RequirePackage[hyphens]{url}
\Urlmuskip=0mu plus 1mu\relax

% These are two lines to adjust font to best match charter.
% \usepackage[scale=0.87]{XCharter}
% \usepackage[libertine,bigdelims,vvarbb,scaled=0.9]{newtxmath} % scale math size to taste
\let\openbox\undefined  % error fix

%%======== Margins and column spacing ========
\RequirePackage[%
left=2.5cm,%
right=2.5cm,%
top=2.5cm,%
bottom=2.5cm,%
headheight=40pt,%
headsep=20pt,%
letterpaper]{geometry}%

\setlength{\columnsep}{22pt} % Distance between the two columns of text
\setlength{\parindent}{0pt}
% \setlength{\parskip}{0.1\baselineskip}
\setlength{\parskip}{1ex}
\setlength{\belowcaptionskip}{6pt}


%% Custom font sizes and styles
\renewcommand\normalsize{\linespread{1.1}\@setfontsize\normalsize{10.0}{11.0}}
\newcommand{\watermarkfont}{\color{black50}\normalfont\fontsize{8.5}{9.5}\selectfont}
\newcommand{\headerfont}{\normalfont\sffamily\fontsize{8}{10}\selectfont}
\newcommand{\titlefont}{\linespread{1.4}\color{black}\normalfont\bfseries\fontsize{28}{28}\selectfont} 
\newcommand{\datesfont}{\normalfont\sffamily\itshape\fontsize{8}{10}\selectfont}
\renewcommand\UrlFont{\color{black}\fontsize{8}{10}\selectfont}
\newcommand{\absfont}{\color{black}\linespread{1.2}\fontsize{9.2}{10}\selectfont}
\newcommand{\keywordstitlefont}{\bfseries\linespread{1.2}\fontsize{8}{10}\selectfont}
\newcommand{\keywordsfont}{\itshape\linespread{1.2}\fontsize{9}{12}\selectfont}
\newcommand{\footerfont}{\color{black}\normalfont\fontsize{8}{10}\selectfont}
\newcommand{\subjectfont}{\color{white}\bfseries\fontsize{10}{12}\selectfont}
\newcommand{\headingfont}{\color{black}\bfseries\fontsize{12}{13}\selectfont}
\newcommand{\bibliofont}{\color{black}\normalfont\fontsize{8.5}{9.5}\selectfont}

\newcommand{\keywords}[1]{\def\@keywords{#1}}
\newtoks\correspondingauthor
\newtoks\paperurl
\newtoks\reportnumber

% Dates and Times for footer
\newdateformat{monthyeardate}{\THEYEAR-\THEMONTH-\THEDAY}

%%======== Boolean values that are part of the package options ========
\newboolean{nonumbering}

\newboolean{internal}

\DeclareOption{nonumbering}{\setboolean{nonumbering}{true}}



\DeclareOption{internal}{\setboolean{internal}{true}}
\ProcessOptions

\setcounter{secnumdepth}{3}
\ifthenelse{\boolean{nonumbering}}{\setcounter{secnumdepth}{0}}{}

%%========  Author and affiliation ========
\RequirePackage{authblk}
\setcounter{Maxaffil}{0}
\setlength{\affilsep}{0.6em}
\renewcommand\Authfont{\linespread{1.1}\normalfont\fontsize{10.0}{11.5}\selectfont}
\renewcommand\Affilfont{\linespread{1.1}\normalfont\fontsize{12.0}{13.5}\selectfont}
\makeatletter
\renewcommand\AB@affilsepx{\protect\Affilfont}
\makeatother
\renewcommand\Authands{ and }

\newcommand{\internalonly}{Google, Confidential. Internal Only.}

%%======== Header and Footer Content ========
%
\makeatletter
\def\footnoterule{\kern-3\p@
  \hrule \@width 3.8in \kern 2.6\p@} % the \hrule is .4pt high
\makeatother

% Header and Footer for the first page
\pagestyle{fancy}   % Enables the custom headers/footers
\fancypagestyle{firststyle}{
    \fancyhf{}
    \renewcommand{\headrulewidth}{0pt}
    \renewcommand{\footrulewidth}{0pt}
    \fancyhead[R]{}
    \fancyhead[C]{}
    
    \fancyfoot[L]{
        \vspace{-3mm}
    	\ifdefined\correspondingauthor
        	\footnoterule
         	\footerfont\itshape  {\correspondingauthor \\} \fi
    % 	\else  {} \fi
    % 	{}
    }
    \fancyfoot[R]{}
    \fancyfoot[C]{\vspace{-3mm}}
    
}

% Header and Footer for pages from 2 onward
\fancyhead[R]{}
\makeatletter
\fancyhead[L]{}
\fancyhead[C]{}
\makeatother
\fancyfoot[C]{\vspace{-3mm}}
\fancyfoot[L]{}
\fancyfoot[R]{\vspace{-3mm} \footerfont |\bfseries{\thepage}}
% \fancyfoot[R]{\vspace{-3mm} \footerfont  | \the\day{}~\monthname~\the\year{}|\bfseries{\thepage}}


\renewcommand{\headrulewidth}{0pt}
\renewcommand{\footrulewidth}{0pt}

% Spacing after header rule
\makeatletter
\def\headrule{{
		\if@fancyplain\let\headrulewidth\plainheadrulewidth\fi
		\color{gray}
		\hrule\@height\headrulewidth\@width\headwidth   
}}
%\setlength\footskip{30pt}
\renewcommand{\footrule}{\hbox to\headwidth{%
		\color{gray}\leaders\hrule height \footrulewidth\hfill}}

\renewenvironment{abstract}
{\par\noindent\\  \ignorespaces \bfseries}
{\par\bigskip}

%%========  Bibliography using bibtex ========
\addto{\captionsenglish}{\renewcommand{\refname}{References}}
\newcommand{\citeas}{\Needspace*{3\baselineskip}\nobibliography*\noindent\bibentry}


%%======== Abstract and section formatting ========
\def\xabstract{abstract}
\long\def\abstract#1\end#2{\def\two{#2}\ifx\two\xabstract 
	\long\gdef\theabstract{\ignorespaces#1}
	\def\go{\end{abstract}}\else
\typeout{^^J^^J PLEASE DO NOT USE ANY \string\begin\space \string\end^^J
	COMMANDS WITHIN ABSTRACT^^J^^J}#1\end{#2}
\gdef\theabstract{\vskip12pt BADLY FORMED ABSTRACT: PLEASE DO
NOT USE {\tt\string\begin...\string\end} COMMANDS WITHIN
THE ABSTRACT\vskip12pt}\let\go\relax\fi
\go}

% Define an environment with abstract content and styling
\newcommand{\abscontent}{
	\noindent
	\begin{center}
        \parbox{\dimexpr 0.9\linewidth}{\absfont \theabstract}
        \@ifundefined{@keywords}{}{
        \vskip1em \noindent \keywordsfont  Keywords: \@keywords}
        \vspace{0pt}   
	\end{center}
}

\if@twocolumn%
\renewcommand{\maketitle}{
	\twocolumn[
	\begin{adjustwidth}{0pt}{24pt}
		\begin{center}
			{
				{\titlefont 
				\@title\par}% 
				\vskip15pt
				{\@author\par}
				\vskip15pt%
			}%
		\end{center}
	\end{adjustwidth}

		\abscontent
	\vskip22pt%
	]
	\thispagestyle{firststyle}
}%
\else% \@twocolumnfalse
\renewcommand{\maketitle}{\bgroup\setlength{\parindent}{0pt}
	\begin{adjustwidth}{0pt}{24pt}
		\begin{center}
			{
				{\titlefont \@title\par}%
				\vskip11pt
				{\@author\par}
				\vskip20pt%
			}%
		\end{center}
	\end{adjustwidth}
	\egroup
	{%
		{\abscontent}
	}%
	\thispagestyle{firststyle}
}%
\fi
\makeatother

\titleformat{\section}
{\bfseries\fontsize{13}{15}\selectfont}
% {\large\bfseries\headingfont}
{\thesection  }
{0.5em}
% {\MakeUppercase{#1}}[]
{#1}
[]
\titleformat{name=\section,numberless}
{\bfseries\fontsize{13}{15}\selectfont}
% {\large\bfseries\headingfont}
{}
{0.45em}
%{\MakeUppercase{#1}}[]
{#1}
[]
\titleformat{\subsection  }
{\bfseries\fontsize{11}{12}\selectfont}
% {\bfseries}
{\thesubsection }
{0.35em}
{#1}
[]
\titleformat{\subsubsection}% [runin] If want to have inline for the subsubsect
{\bfseries\fontsize{10}{11}\selectfont}
{\thesubsubsection  }
{0.35em}
{#1}
[]


% \titlespacing*{\paragraph}     {0pc} {3pt\@plus2.5pt\@minus1.5pt} {5pt}
% \titlespacing*{\section}       {0pc} {3ex\@plus4pt\@minus3pt}     {5pt}
% \titlespacing*{\subsection}    {0pc} {2.5ex\@plus3pt\@minus2pt}   {2pt}
% \titlespacing*{\subsubsection} {0pc} {2ex\@plus2.5pt\@minus1.5pt} {2pt}

\titlespacing*{\section}      {0em}{.70em}{.60em}
\titlespacing*{\subsection}   {0em}{.50em}{.40em}
\titlespacing*{\subsubsection}{0em}{.50em}{.40em}
\titlespacing*{\paragraph}    {0em}{.50em}{.40em}

%%======== Captions in tables and figures ========
\DeclareCaptionLabelSeparator{pipe}{ $\vert$ }% or $\vert$
\captionsetup{labelfont={bf,footnotesize}, %{bf,sf},%
labelsep=space,%  %{quad,space}
figurename=Figure,%
labelsep=pipe,
singlelinecheck=off,%
belowskip=6pt,
aboveskip=0pt,
%justification=centering
}


