def main() -> None:
    import numpy as np
    import faiss
    from sklearn.metrics.pairwise import cosine_similarity

    # 1. Define dimensions and create dummy data (1,000 vectors of size 64)
    dimension = 64
    num_vectors = 1000
    np.random.seed(42)

    # FAISS requires float32 numpy arrays
    data = np.random.random((num_vectors, dimension)).astype('float32')

    # 2. Initialize a Flat L2 (Euclidean Distance) Index
    index = faiss.IndexFlatL2(dimension)
    print(f"Is index trained? {index.is_trained}")  # True for Flat indexes

    # 3. Add vectors to the index
    index.add(data)
    print(f"Total vectors in index: {index.ntotal}")

    # 4. Search the index with query vectors
    num_queries = 2
    queries = np.random.random((num_queries, dimension)).astype('float32')

    k = 5  # Find the 5 nearest neighbors
    distances, indices = index.search(queries, k)

    # 5. Output results
    print("\nClosest vector IDs:\n", indices)
    print("\nCorresponding squared L2 distances:\n", distances)

    # 6. Cosine similarity (Scikit-learn)
    sim = cosine_similarity(queries, data)
    print("\nCosine Similarity Matrix:", sim.argsort(-1)[:, ::-1])
    # print("\nMax cosine similarity for query 1:", np.max(sim[0]))
    # print("Max cosine similarity for query 2:", np.max(sim[1]))
    print(sim[0, 785])
    print(sim[0, 606])
